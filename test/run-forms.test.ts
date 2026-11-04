/**
 * The forms pass in a run: each form gets a load of its own with the guard's gate in front of the
 * browser, a form tested on one page is tested once in the run, and a problem in the pass never
 * fails the page's other passes. The Guidepup driver's own side is in guidepup-driver.test.ts.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenPageOptions, PageInfo, Speech } from "../src/drivers/types.js";
import type { FormInfo, FormState } from "../src/forms/types.js";
import * as ResultFile from "../src/forms/result-file.js";
import { fileHash } from "../src/transcripts/write.js";
import { runAudit } from "../src/run/audit.js";
import { pageDir } from "../src/run/paths.js";
import { readRunJson } from "../src/run/store.js";
import * as PageRunner from "../src/run/page-runner.js";
import { ExitCode } from "../src/util/errors.js";
import { verifyHome } from "../src/verify.js";
import { createMemoryLogger } from "../src/util/log.js";
import { config, options, outDir, setup, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

vi.mock("../src/run/page-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof PageRunner>();
  return { ...actual, processPage: vi.fn(actual.processPage) };
});

vi.mock("../src/forms/result-file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ResultFile>();
  return { ...actual, keptFormsResults: vi.fn(actual.keptFormsResults) };
});

afterEach(() => {
  vi.mocked(ResultFile.keptFormsResults).mockClear();
  vi.mocked(PageRunner.processPage).mockClear();
});

/** A form of one optional field, which a press sends at once: it can be completed by a press. */
function formOf(index: number, signature: string, overrides: Partial<FormInfo> = {}): FormInfo {
  return {
    index,
    signature,
    kind: "test",
    site: null,
    fields: [{ index: 0, name: "Name", type: "text", required: false, tabIndex: 0 }],
    submitName: "Send",
    sensitive: false,
    captcha: false,
    ...overrides,
  };
}

/** The forms a page shows, by its address. */
type FormsBySite = Record<string, FormInfo[]>;

/**
 * The scripted driver with forms: a page shows the forms listed for it, and each load has a guard of
 * its own, which holds one request for each press.
 */
class FormsDriver extends ScriptedDriver {
  /** The options of every load, with its address. */
  readonly loads: { url: string; options: OpenPageOptions | undefined }[] = [];
  /** What the forms pass did, in order, each with the load it was on (1 is the first). */
  readonly made: string[] = [];
  private load = 0;
  private url = "";
  private focus: "field" | "submit" | "out" | null = null;
  private held = 0;
  private armed = false;

  constructor(
    private readonly forms: FormsBySite,
    private readonly fails: { armOnLoad?: number; findOnLoad?: number } = {},
  ) {
    super(sitePages());
  }

  override async openPage(url: string, opened?: OpenPageOptions): Promise<PageInfo> {
    this.loads.push({ url, options: opened });
    this.load += 1;
    this.url = new URL(url).pathname;
    this.focus = null;
    this.held = 0;
    this.armed = false;
    return super.openPage(url);
  }

  findForms(): Promise<FormInfo[]> {
    this.made.push(`findForms ${this.load}`);
    if (this.fails.findOnLoad === this.load) return Promise.reject(new Error("the scan failed"));
    return Promise.resolve(this.forms[this.url] ?? []);
  }

  armFormGuard(): Promise<void> {
    this.made.push(`armFormGuard ${this.load}`);
    if (this.fails.armOnLoad === this.load) return Promise.reject(new Error("no gate"));
    this.armed = true;
    return Promise.resolve();
  }

  focusFormField(form: number, field: number): Promise<Speech> {
    this.made.push(`focusFormField ${this.load} ${form}.${field}`);
    this.focus = "field";
    return Promise.resolve("Name, edit, blank");
  }

  override nextFocusable(): Promise<Speech> {
    if (this.focus === null) return super.nextFocusable();
    this.focus = this.focus === "field" ? "submit" : "out";
    return Promise.resolve(this.focus === "submit" ? "Send, button" : "");
  }

  override focusInDocument(): Promise<boolean> {
    return this.focus === null ? super.focusInDocument() : Promise.resolve(this.focus !== "out");
  }

  pressSubmit(form: number, settleMs: number): Promise<Speech> {
    this.made.push(`pressSubmit ${this.load} ${form}`);
    void settleMs;
    if (this.armed) this.held += 1;
    return Promise.resolve("");
  }

  fillField(): Promise<Speech> {
    this.made.push(`fillField ${this.load}`);
    return Promise.resolve("v");
  }

  formState(form: number): Promise<FormState> {
    void form;
    return Promise.resolve({
      focused: null,
      focusedField: this.focus === "field" ? 0 : null,
      focusedSubmit: this.focus === "submit",
      invalid: [],
      emptyRequired: [],
      messages: [],
      liveChanged: false,
      heldRequests: this.held,
      present: true,
      bubble: null,
    });
  }

  /** How many times the pass did `call`, whatever load it was on. */
  count(call: string): number {
    return this.made.filter((made) => made.startsWith(call)).length;
  }
}

const TWO_FORMS: FormsBySite = {
  "/": [formOf(0, "signup"), formOf(1, "contact")],
  "/about": [formOf(0, "signup")],
};

/** A run of the home and about pages, with these passes. */
async function run(driver: ScriptedDriver, pages = ["/", "/about"], passes = ["forms"]) {
  const dir = await setup(pages);
  const result = await runAudit(
    options(dir, driver, { config: config({ passes: passes as never }) }),
  );
  return { dir, result };
}

/** What the forms pass concluded on the pages processed, in order, by page. */
async function outcomesOf() {
  const done = await Promise.all(
    vi
      .mocked(PageRunner.processPage)
      .mock.results.map((call) => call.value as Promise<PageRunner.PageOutcome>),
  );
  return done.map((outcome) => outcome.results.forms?.forms ?? null);
}

describe("each form's load", () => {
  it("is a load of its own, guarded, with a fresh guard armed on it", async () => {
    const driver = new FormsDriver({ "/": TWO_FORMS["/"]! });
    const { result } = await run(driver, ["/"]);
    expect(result.outcome).toBe("completed");

    // One load finds the forms and serves the first; the second form gets another.
    expect(driver.loads.map((load) => load.options)).toEqual([
      { guarded: true },
      { guarded: true },
    ]);
    expect(driver.made.filter((made) => /^(findForms|armFormGuard)/.test(made))).toEqual([
      "findForms 1",
      "armFormGuard 1",
      "findForms 2",
      "armFormGuard 2",
    ]);
    expect(driver.count("pressSubmit")).toBe(2);
    const [forms] = await outcomesOf();
    expect(forms?.map((outcome) => outcome.result)).toEqual(["completed", "completed"]);
  });

  it("finds the next form again on its load by its signature, even where the scan numbers it differently", async () => {
    const driver = new FormsDriver({ "/": TWO_FORMS["/"]! });
    const find = driver.findForms.bind(driver);
    driver.findForms = async () => {
      const forms = await find();
      // The second load lists the forms the other way round.
      return driver.loads.length === 2
        ? [...forms].reverse().map((form, i) => ({ ...form, index: i }))
        : forms;
    };
    await run(driver, ["/"]);
    expect(driver.made).toContain("focusFormField 2 0.0");
  });

  it("says the form wasn't there when the page loaded again, and tests no other", async () => {
    const driver = new FormsDriver({ "/": TWO_FORMS["/"]! });
    const find = driver.findForms.bind(driver);
    driver.findForms = async () => (await find(), driver.loads.length === 2 ? [] : await find());
    await run(driver, ["/"]);
    const [forms] = await outcomesOf();
    expect(forms?.map((outcome) => outcome.reason)).toEqual([
      null,
      "the form wasn't on the page when it loaded again",
    ]);
  });
});

describe("a form on two pages", () => {
  it("is tested on the first and, on the second, says where, with no press", async () => {
    const driver = new FormsDriver(TWO_FORMS);
    const { dir, result } = await run(driver);
    expect(result.outcome).toBe("completed");

    const [home, about] = await outcomesOf();
    expect(home?.map((outcome) => outcome.form.signature)).toEqual(["signup", "contact"]);
    expect(about).toHaveLength(1);
    expect(about?.[0]).toMatchObject({ result: "not-tested", reason: "tested on /", presses: [] });
    // 2 presses on the home page, none on /about, and a guard armed only for the two.
    expect(driver.count("pressSubmit")).toBe(2);
    expect(driver.count("armFormGuard")).toBe(2);
    const stored = await readRunJson(outDir(dir), result.runId);
    expect(stored.formSignatures).toEqual({ signup: "/", contact: "/" });
  });

  it("is tested once on a page that shows it twice", async () => {
    const driver = new FormsDriver({ "/": [formOf(0, "signup"), formOf(1, "signup")] });
    await run(driver, ["/"]);
    const [forms] = await outcomesOf();
    expect(forms?.map((outcome) => outcome.reason)).toEqual([null, "tested on /"]);
    expect(driver.count("pressSubmit")).toBe(1);
  });

  it("keeps the signatures when the run is resumed, so the form isn't tested again", async () => {
    const dir = await setup(["/", "/about"]);
    const controller = new AbortController();
    const first = new FormsDriver(TWO_FORMS);
    // Ctrl+C as the second page is opened.
    const open = first.openPage.bind(first);
    first.openPage = (url, opened) => {
      if (url.endsWith("/about")) controller.abort();
      return open(url, opened);
    };
    const settings = { config: config({ passes: ["forms"] }) };
    const interrupted = await runAudit(
      options(dir, first, { ...settings, signal: controller.signal }),
    );
    expect(interrupted.outcome).toBe("interrupted");

    const second = new FormsDriver(TWO_FORMS);
    const resumed = await runAudit(options(dir, second, settings));
    expect(resumed).toMatchObject({ runId: interrupted.runId, outcome: "completed" });
    expect(second.count("pressSubmit")).toBe(0);
    expect(second.count("armFormGuard")).toBe(0);
  });
});

describe("more forms than the pass takes", () => {
  it("tests the first maxPerPage and says how many it left", async () => {
    const forms = ["a", "b", "c", "d"].map((signature, i) => formOf(i, signature));
    const driver = new FormsDriver({ "/": forms });
    const dir = await setup(["/"]);
    const result = await runAudit(
      options(dir, driver, { config: config({ passes: ["forms"], forms: { maxPerPage: 3 } }) }),
    );
    expect(driver.count("pressSubmit")).toBe(3);
    expect(result.run.pages[0]?.passes.forms?.warnings).toEqual([
      "1 more form was left untested: the pass takes 3 a page",
    ]);
  });
});

describe("a page with no forms", () => {
  it("has no forms transcripts, and no gap", async () => {
    const driver = new FormsDriver({});
    const { dir, result } = await run(driver, ["/"], ["read", "forms"]);
    expect(result.outcome).toBe("completed");

    const page = result.run.pages[0]!;
    expect(page.status).toBe("done");
    expect(page.passes.forms).toBeUndefined();
    expect(Object.keys(page.files).sort()).toEqual(["read.json", "read.txt"]);
    const folder = pageDir(outDir(dir), result.runId, page.slug);
    expect(existsSync(path.join(folder, "forms.txt"))).toBe(false);
    expect(existsSync(path.join(folder, "forms.json"))).toBe(false);
    const home = path.join(dir, "transcripts");
    expect((await verifyHome({ home, logger: createMemoryLogger() })).problems).toBe(0);
  });

  it("keeps the transcripts of a page that has forms", async () => {
    const driver = new FormsDriver({ "/": [formOf(0, "signup")] });
    const { result } = await run(driver, ["/"]);
    const page = result.run.pages[0]!;
    expect(page.passes.forms?.stopReason).toBe("forms-done");
    expect(Object.keys(page.files).sort()).toEqual(["forms.json", "forms.txt"]);
  });
});

describe("a problem in the forms pass", () => {
  it("leaves the page's other passes done, and the page done", async () => {
    // The scan on the first load fails, and the page isn't retried.
    const driver = new FormsDriver({ "/": TWO_FORMS["/"]! }, { findOnLoad: 3 });
    const { result } = await run(driver, ["/"], ["read", "forms", "headings"]);
    expect(result.outcome).toBe("completed");

    const page = result.run.pages[0]!;
    expect(page).toMatchObject({ status: "done", attempts: 1 });
    expect(page.passes.read?.stopReason).toBe("end-reached");
    expect(page.passes.headings?.stopReason).toBe("no-next-heading");
    expect(page.passes.forms).toMatchObject({ stopReason: "error", errors: ["the scan failed"] });
    expect(driver.stops).toBe(1);
  });

  it("is a form not tested, not a page failed, when the guard can't be armed", async () => {
    const driver = new FormsDriver({ "/": [formOf(0, "signup")] }, { armOnLoad: 1 });
    const { dir, result } = await run(driver, ["/"]);
    expect(result.run.pages[0]?.status).toBe("done");
    const [forms] = await outcomesOf();
    expect(forms?.[0]).toMatchObject({ result: "not-tested", presses: [] });
    expect(driver.count("pressSubmit")).toBe(0);
    // Nothing was pressed, so a later page still tests the form.
    expect((await readRunJson(outDir(dir), result.runId)).formSignatures).toBeUndefined();
  });
});

describe("Ctrl+C in the middle of a form", () => {
  it("keeps no outcome for it, and the retry opens a fresh page and arms a fresh guard", async () => {
    const dir = await setup(["/"]);
    const controller = new AbortController();
    const first = new FormsDriver({ "/": [formOf(0, "signup")] });
    const press = first.pressSubmit.bind(first);
    first.pressSubmit = (form, settleMs) => {
      controller.abort();
      return press(form, settleMs);
    };
    const settings = { config: config({ passes: ["forms"] }) };
    const interrupted = await runAudit(
      options(dir, first, { ...settings, signal: controller.signal }),
    );
    expect(interrupted.outcome).toBe("interrupted");

    const saved = await readRunJson(outDir(dir), interrupted.runId);
    expect(saved.pages[0]).toMatchObject({ status: "pending" });
    expect(saved.pages[0]?.passes ?? {}).toEqual({});
    expect(saved.formSignatures).toBeUndefined();
    expect(
      existsSync(
        path.join(pageDir(outDir(dir), interrupted.runId, saved.pages[0]!.slug), "forms.json"),
      ),
    ).toBe(false);

    const second = new FormsDriver({ "/": [formOf(0, "signup")] });
    const resumed = await runAudit(options(dir, second, settings));
    expect(resumed.outcome).toBe("completed");
    expect(second.loads).toHaveLength(1);
    expect(second.loads[0]?.options).toEqual({ guarded: true });
    expect(second.made.filter((made) => made.startsWith("armFormGuard"))).toEqual([
      "armFormGuard 1",
    ]);
    expect(second.count("pressSubmit")).toBe(1);
  });
});

describe("the order of the passes", () => {
  it("runs forms last, whatever order --passes gives, and the others in the order given", async () => {
    const driver = new FormsDriver({ "/": [formOf(0, "signup")] });
    const dir = await setup(["/"]);
    const result = await runAudit(
      options(dir, driver, { config: config({ passes: ["forms", "headings", "read"] }) }),
    );
    expect(result.run.settings.passes).toEqual(["headings", "read", "forms"]);
    // The forms pass's guarded load is the last, after the other two passes' loads.
    expect(driver.loads.map((load) => load.options)).toEqual([
      undefined,
      undefined,
      { guarded: true },
    ]);
    expect(result.run.pages[0]?.passes.forms?.stopReason).toBe("forms-done");
  });
});

describe("the forms record's count of loads", () => {
  it("counts a load for every form after the first, whatever came of it", async () => {
    // One form is pressed; the search form after it gets a load though nothing is pressed there; the
    // last is the first again, tested already, and gets none. So two loads for three forms.
    const forms = [formOf(0, "signup"), formOf(1, "find", { kind: "search" }), formOf(2, "signup")];
    const driver = new FormsDriver({ "/": forms });
    const { dir, result } = await run(driver, ["/"]);
    const home = result.run.pages[0]!;
    expect(driver.loads).toHaveLength(2);
    expect(home.forms).toMatchObject({ counts: { forms: 3, completed: 1, notTested: 2 } });
    const text = await readFile(
      path.join(pageDir(outDir(dir), result.runId, home.slug), "forms-result.json"),
      "utf8",
    );
    const counts = (JSON.parse(text) as { counts: { loads: number } }).counts;
    expect(counts.loads).toBe(driver.loads.length);
    expect((home.forms as { counts: { loads: number } }).counts.loads).toBe(driver.loads.length);
  });
});

describe("the forms record", () => {
  const resultOf = (dir: string, runId: string, slug: string) =>
    path.join(pageDir(outDir(dir), runId, slug), "forms-result.json");

  it("writes forms-result.json, and records its fingerprint, counts, and when with the page", async () => {
    const driver = new FormsDriver(TWO_FORMS);
    const { dir, result } = await run(driver);
    const [home, about] = result.run.pages;

    const text = await readFile(resultOf(dir, result.runId, home!.slug), "utf8");
    expect(home!.forms).toMatchObject({
      ...fileHash(text),
      counts: { forms: 2, completed: 2, stuck: 0, notTested: 0, presses: 2, loads: 2 },
    });
    expect(home!.forms).toHaveProperty("ranAt");
    const file = JSON.parse(text) as { page: string; forms: { form: { signature: string } }[] };
    expect(file.page).toBe("/");
    expect(file.forms.map((form) => form.form.signature)).toEqual(["signup", "contact"]);

    // The second page's one form was tested on the first: it says so, with no press.
    const aboutText = await readFile(resultOf(dir, result.runId, about!.slug), "utf8");
    expect(about!.forms).toMatchObject({
      ...fileHash(aboutText),
      counts: { forms: 1, completed: 0, stuck: 0, notTested: 1, presses: 0, loads: 1 },
    });
    expect((await readRunJson(outDir(dir), result.runId)).pages[0]?.forms).toEqual(home!.forms);
    // The file is no transcript: the page's files are the forms pass's two.
    expect(Object.keys(home!.files).sort()).toEqual(["forms.json", "forms.txt"]);
  });

  it("is verified, and sealed with the run", async () => {
    const { dir } = await run(new FormsDriver(TWO_FORMS));
    const home = path.join(dir, "transcripts");
    expect((await verifyHome({ home, logger: createMemoryLogger() })).problems).toBe(0);
  });

  it("is left out for a page with no forms, and for a run without the forms pass", async () => {
    const { dir, result } = await run(new FormsDriver({}), ["/"], ["read", "forms"]);
    expect(result.run.pages[0]).not.toHaveProperty("forms");
    expect(existsSync(resultOf(dir, result.runId, result.run.pages[0]!.slug))).toBe(false);

    const without = await run(new FormsDriver(TWO_FORMS), ["/"], ["read"]);
    expect(without.result.run.pages[0]).not.toHaveProperty("forms");
    expect(existsSync(resultOf(without.dir, without.result.runId, "home"))).toBe(false);
    expect(
      (
        await verifyHome({
          home: path.join(without.dir, "transcripts"),
          logger: createMemoryLogger(),
        })
      ).problems,
    ).toBe(0);
  });

  it("records why it has none when it can't be written, and the page is done all the same", async () => {
    vi.mocked(ResultFile.keptFormsResults).mockImplementationOnce(() => {
      throw new Error("no room in the folder");
    });
    const { dir, result } = await run(
      new FormsDriver({ "/": [formOf(0, "signup")] }),
      ["/"],
      ["read", "forms"],
    );
    const page = result.run.pages[0]!;
    expect(page.status).toBe("done");
    expect(page.passes.read?.stopReason).toBe("end-reached");
    expect(page.forms).toMatchObject({
      error: "Could not keep the forms results: no room in the folder",
    });
    expect(page.forms).toHaveProperty("ranAt");
    expect(existsSync(resultOf(dir, result.runId, page.slug))).toBe(false);
    expect(
      (await verifyHome({ home: path.join(dir, "transcripts"), logger: createMemoryLogger() }))
        .problems,
    ).toBe(0);
  });
});

describe("a forms flag", () => {
  it("never changes the run's exit code", async () => {
    // A press that holds no request and changes nothing: the form is stuck, and the flag is raised.
    class NothingHappens extends FormsDriver {
      override pressSubmit(form: number, settleMs: number): Promise<Speech> {
        this.made.push(`pressSubmit ${form} ${settleMs}`);
        return Promise.resolve("");
      }
    }
    const { result } = await run(new NothingHappens(TWO_FORMS), ["/"]);
    const flags = result.run.pages.flatMap((page) => page.flags.map((flag) => flag.rule));

    expect(flags).toContain("form-no-feedback");
    expect(flags).toContain("form-cant-finish");
    expect(result.exitCode).toBe(ExitCode.ok);
  });
});
