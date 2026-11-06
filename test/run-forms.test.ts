/**
 * The forms pass in a run: a fresh load and a fresh guard for each form, what a run keeps of the forms
 * it has tested, and how a problem at a form stays out of the page. The driver's real side is in
 * test/guidepup-driver.test.ts, and the browser's in test/form-guard.test.ts.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FORMS_DEFAULTS, formsSettingsOf } from "../src/config/defaults.js";
import type { PageInfo } from "../src/drivers/types.js";
import { runPass, type PassSettings } from "../src/passes/index.js";
import { runAudit } from "../src/run/audit.js";
import { pageDir } from "../src/run/paths.js";
import { readRunJson } from "../src/run/store.js";
import { FakeFormDriver, FakeFormSite, type FakeForm } from "./helpers/fake-form-driver.js";
import { config, options, outDir, setup, SITE, sitePages } from "./helpers/run-site.js";

const HOME = `${SITE}/`;
const ABOUT = `${SITE}/about`;
const NAME: FakeForm["fields"] = [{ name: "Name" }];

const form = (signature: string, extra: Partial<FakeForm> = {}): FakeForm => ({
  fields: NAME,
  signature,
  ...extra,
});

/** A run of the site's first two pages with `forms`, taking `passes`. */
async function run(
  forms: Record<string, FakeForm[]>,
  passes: ("read" | "headings" | "tab" | "forms")[] = ["forms"],
  extra: Parameters<typeof options>[2] = {},
) {
  const dir = await setup(["/", "/about"]);
  const site = new FakeFormSite(sitePages(), forms);
  const result = await runAudit(options(dir, site, { passes, ...extra }));
  return { dir, site, result };
}

describe("a page's forms in a run", () => {
  it("gives each form its own load, its own guard, and only forms-pass loads a gate", async () => {
    const { site, result } = await run({ [HOME]: [form("a"), form("b")] }, ["read", "forms"]);
    expect(result.outcome).toBe("completed");
    const home = site.journal.filter((call) => call.includes(`${HOME} `) || call.endsWith(HOME));
    expect(home).toEqual([
      `open ${HOME} plain`,
      `open ${HOME} guarded`,
      `arm ${HOME}`,
      `press ${HOME} a`,
      `press ${HOME} a`,
      `open ${HOME} guarded`,
      `arm ${HOME}`,
      `press ${HOME} b`,
      `press ${HOME} b`,
    ]);
  });

  it("tests a form once in a run, and a later page says where", async () => {
    const { site, result } = await run({ [HOME]: [form("footer")], [ABOUT]: [form("footer")] });
    expect(site.count(`press ${HOME}`)).toBeGreaterThan(0);
    expect(site.count(`press ${ABOUT}`)).toBe(0);
    expect(site.count(`arm ${ABOUT}`)).toBe(0);
    expect(result.run.formSignatures).toEqual({ footer: "/" });
    const about = result.run.pages.find((page) => page.url === ABOUT);
    expect(about?.passes.forms?.warnings.join(" ")).toContain("tested on /");
  });

  it("tests twice over no form that's on a page twice", async () => {
    const { site } = await run({ [HOME]: [form("twin"), form("twin")] });
    expect(site.count(`open ${HOME} guarded`)).toBe(1);
  });

  it("tests the first of a page's forms, and says how many it left", async () => {
    const { site, result } = await run(
      { [HOME]: [form("a"), form("b"), form("c"), form("d")] },
      ["forms"],
      { config: config({ forms: { maxPerPage: 2 } }) },
    );
    expect(site.count(`arm ${HOME}`)).toBe(2);
    const home = result.run.pages.find((page) => page.url === HOME);
    expect(home?.passes.forms?.warnings.join(" ")).toContain("left 2");
  });

  it("keeps no transcript of a page with no forms, and that's no gap", async () => {
    const { dir, result } = await run({ [HOME]: [form("a")] }, ["read", "forms"]);
    const about = result.run.pages.find((page) => page.url === ABOUT)!;
    expect(about.status).toBe("done");
    expect(Object.keys(about.passes)).toEqual(["read"]);
    expect(about.errors).toEqual([]);
    const folder = pageDir(outDir(dir), result.run.id, about.slug);
    expect(existsSync(path.join(folder, "forms.txt"))).toBe(false);
    expect(existsSync(path.join(folder, "forms.json"))).toBe(false);
    const home = result.run.pages.find((page) => page.url === HOME)!;
    const homeFolder = pageDir(outDir(dir), result.run.id, home.slug);
    expect(existsSync(path.join(homeFolder, "forms.json"))).toBe(true);
  });

  it("keeps the transcript of a page with no forms that has a warning to give", async () => {
    const dir = await setup(["/"]);
    const stuck = { axe: { error: "timed out", leftRunning: true as const } };
    const site = new FakeFormSite(sitePages({ home: stuck }), {});
    const open = site.openPage.bind(site);
    let loads = 0;
    site.openPage = async (url, given) => {
      const info = await open(url, given);
      loads += 1;
      return loads === 1 ? info : { ...info, finalUrl: `${HOME}elsewhere` };
    };
    const result = await runAudit(options(dir, site, { passes: ["forms"] }));
    expect(result.run.pages[0]?.passes.forms?.warnings.join(" ")).toContain("elsewhere");
  });

  it("runs the forms pass last, whichever order it's named in", async () => {
    const { site } = await run({ [HOME]: [form("a")] }, ["forms", "read"]);
    expect(site.journal.slice(0, 2)).toEqual([`open ${HOME} plain`, `open ${HOME} guarded`]);
  });

  it("gives no load to a form that gets no press", async () => {
    const { site } = await run({ [HOME]: [form("s", { kind: "search" }), form("a")] });
    expect(site.count(`open ${HOME} guarded`)).toBe(1);
    expect(site.journal).toContain(`press ${HOME} a`);
  });

  it("bounds a page's steps by what a form may take and how many forms it tests", async () => {
    const fields: FakeForm["fields"] = [{ name: "A" }, { name: "B" }, { name: "C" }];
    const { result } = await run(
      { [HOME]: [form("a", { fields }), form("b", { fields }), form("c", { fields })] },
      ["forms"],
      {
        config: config({ forms: { maxPerPage: 2 }, stepCaps: { forms: 5 } }),
      },
    );
    const home = result.run.pages.find((page) => page.url === HOME);
    expect(home?.passes.forms?.steps).toBeLessThanOrEqual(10);
    expect(home?.passes.forms?.stopReason).toBe("step-cap");
  });
});

describe("a problem at a form", () => {
  const broken = (): FakeForm =>
    form("bad", {
      onPress: () => {
        throw new Error("NVDA went quiet");
      },
    });

  it("leaves the page done, with its other passes and the forms before it kept", async () => {
    const { result, site } = await run({ [HOME]: [form("good"), broken()] }, [
      "read",
      "headings",
      "tab",
      "forms",
    ]);
    expect(result.outcome).toBe("completed");
    const home = result.run.pages.find((page) => page.url === HOME)!;
    expect(home.status).toBe("done");
    expect(home.attempts).toBe(1);
    expect(home.failedAttempts).toBeUndefined();
    expect(home.passes.read?.errors).toEqual([]);
    expect(home.passes.forms?.errors.join(" ")).toContain("NVDA went quiet");
    expect(result.run.formSignatures).toEqual({ good: "/" });
    expect(site.count(`open ${HOME} plain`)).toBe(3);
    // The page after it gets a screen reader and a browser that are sure to be well.
    expect(site.stopOptions).toContainEqual({ restarting: true });
  });

  it("says what came of every form, the ones before it kept", async () => {
    const site = new FakeFormDriver(form("good"));
    const bad = new FakeFormDriver(broken(), 1);
    const driver = Object.assign(site, {
      findForms: () => Promise.resolve([site.info, bad.info]),
      pressSubmit: (index: number, settle: number) =>
        index === 0
          ? FakeFormDriver.prototype.pressSubmit.call(site, index, settle)
          : Promise.reject(new Error("NVDA went quiet")),
    });
    const result = await runPass("forms", driver, settings, undefined, undefined, {
      opened: true,
      open: () => Promise.resolve(),
      path: "/",
      tested: {},
    });
    expect(result.stopReason).toBe("error");
    expect(result.forms?.map((outcome) => outcome.result)).toEqual(["completed", "not-tested"]);
  });

  it("stays out of the page when the load for the pass won't open", async () => {
    const dir = await setup(["/"]);
    const site = new FakeFormSite(sitePages(), { [HOME]: [form("a")] });
    const open = site.openPage.bind(site);
    site.openPage = (url, opened) =>
      opened?.formGuard ? Promise.reject(new Error("the gate wouldn't open")) : open(url, opened);
    const result = await runAudit(options(dir, site, { passes: ["read", "forms"] }));
    const home = result.run.pages[0]!;
    expect(home.status).toBe("done");
    expect(home.attempts).toBe(1);
    expect(home.passes.read).toBeDefined();
    expect(home.passes.forms?.errors.join(" ")).toContain("the gate wouldn't open");
  });

  describe("a guarded load that isn't the page", () => {
    /** A run whose guarded loads are changed by `change`: the page's plain loads are as they are. */
    async function runChanged(change: (info: PageInfo) => PageInfo) {
      const dir = await setup(["/"]);
      const site = new FakeFormSite(sitePages(), { [HOME]: [form("a")] });
      const open = site.openPage.bind(site);
      site.openPage = async (url, given) => {
        const info = await open(url, given);
        return given?.formGuard ? change(info) : info;
      };
      const result = await runAudit(options(dir, site, { passes: ["read", "forms"] }));
      return { dir, site, result, home: result.run.pages[0]! };
    }

    it.each([
      ["answers 503", (info: PageInfo) => ({ ...info, status: 503 }), "503"],
      ["answers 403", (info: PageInfo) => ({ ...info, status: 403 }), "403"],
      ["isn't HTML", (info: PageInfo) => ({ ...info, contentType: "application/pdf" }), "HTML"],
      [
        "lands on another page",
        (info: PageInfo) => ({ ...info, finalUrl: `${SITE}/login` }),
        `${SITE}/login`,
      ],
    ])(
      "tests nothing and says why when it %s, so it never reads as no forms",
      async (_, change, why) => {
        const { dir, site, result, home } = await runChanged(change);
        expect(home.status).toBe("done");
        expect(home.attempts).toBe(1);
        expect(home.passes.read).toBeDefined();
        expect(home.passes.forms?.errors.join(" ")).toContain(why);
        expect(site.count(`arm ${HOME}`)).toBe(0);
        expect(result.run.formSignatures).toBeUndefined();
        const folder = pageDir(outDir(dir), result.run.id, home.slug);
        expect(existsSync(path.join(folder, "forms.json"))).toBe(true);
      },
    );
  });

  it("keeps nothing of the form Ctrl+C stopped, and a retry starts it afresh", async () => {
    const dir = await setup(["/"]);
    const controller = new AbortController();
    const pressCtrlC = form("a", { onPress: () => controller.abort() });
    const first = new FakeFormSite(sitePages(), { [HOME]: [form("before"), pressCtrlC] });
    const stopped = await runAudit(
      options(dir, first, { passes: ["forms"], signal: controller.signal }),
    );
    expect(stopped.outcome).toBe("interrupted");
    expect(stopped.run.pages[0]?.status).toBe("pending");
    expect(stopped.run.formSignatures).toBeUndefined();

    const second = new FakeFormSite(sitePages(), { [HOME]: [form("before"), form("a")] });
    const resumed = await runAudit(options(dir, second, { passes: ["forms"] }));
    expect(resumed.run.id).toBe(stopped.run.id);
    expect(second.journal.slice(0, 2)).toEqual([`open ${HOME} guarded`, `arm ${HOME}`]);
    expect(second.count(`arm ${HOME}`)).toBe(2);
    expect(resumed.run.formSignatures).toEqual({ before: "/", a: "/" });
  });
});

describe("FormSignatures across a run's sessions", () => {
  it("are kept in run.json, so a resumed run doesn't repeat a form", async () => {
    const dir = await setup(["/", "/about"]);
    const controller = new AbortController();
    const first = new FakeFormSite(sitePages(), {
      [HOME]: [form("footer")],
      [ABOUT]: [form("footer"), form("about", { onPress: () => controller.abort() })],
    });
    const stopped = await runAudit(
      options(dir, first, { passes: ["forms"], signal: controller.signal }),
    );
    expect(stopped.outcome).toBe("interrupted");
    const onDisk = await readRunJson(outDir(dir), stopped.run.id);
    expect(onDisk.formSignatures).toEqual({ footer: "/" });

    const second = new FakeFormSite(sitePages(), {
      [HOME]: [form("footer")],
      [ABOUT]: [form("footer"), form("about")],
    });
    await runAudit(options(dir, second, { passes: ["forms"] }));
    expect(second.count(`press ${HOME} `)).toBe(0);
    expect(second.journal).not.toContain(`press ${ABOUT} footer`);
    expect(second.journal).toContain(`press ${ABOUT} about`);
  });
});

describe("a config's forms.values", () => {
  it("merges over the defaults", () => {
    const { config: resolved } = config({ forms: { values: { email: "me@example.org" } } });
    expect(formsSettingsOf(resolved).values).toEqual({
      ...FORMS_DEFAULTS.values,
      email: "me@example.org",
    });
  });
});

const settings: PassSettings = {
  cap: 500,
  repeatLimit: 10,
  endConfirmations: 1,
  noNextHeading: /^no next heading$/i,
  stepTimeoutMs: 1000,
  forms: { settleMs: 0, values: FORMS_DEFAULTS.values },
};
