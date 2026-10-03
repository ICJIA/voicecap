/**
 * `--walkthrough`, runAudit's `walkthrough` option: a run repeated from its walkthrough file. Every
 * file is written from a real scripted run, by the writer `voicecap walkthrough` uses, and repeated
 * with the scripted driver, or with the replay driver where a test looks at the config the driver
 * is made with. No real screen reader starts here.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { copyFile, mkdir, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type * as Drivers from "../src/drivers/index.js";
import { createDriver } from "../src/drivers/index.js";
import { readWalkthroughFile } from "../src/pages/resolve.js";
import type { PlatformReadiness } from "../src/readiness/model.js";
import { runAudit, type RunAuditOptions, type RunAuditResult } from "../src/run/audit.js";
import type * as PageRunner from "../src/run/page-runner.js";
import { processPage } from "../src/run/page-runner.js";
import { siteFolder } from "../src/run/paths.js";
import { listRuns } from "../src/run/store.js";
import { parseWalkthrough, walkthroughJson, type Walkthrough } from "../src/share/walkthrough.js";
import { writeWalkthrough } from "../src/share/write-walkthrough.js";
import { UsageError } from "../src/util/errors.js";
import { createMemoryLogger, type MemoryLogger } from "../src/util/log.js";
import { voicecapVersion } from "../src/util/version.js";
import { gitBashForm } from "./helpers/git-bash.js";
import {
  config,
  options as runOptions,
  outDir,
  setup,
  SITE,
  sitePages,
} from "./helpers/run-site.js";
import { element, ScriptedDriver } from "./helpers/scripted-driver.js";

// Every call goes through as it did, and is kept: the config each driver is made with, what the page
// runner is given, and which files are read.
vi.mock("../src/drivers/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof Drivers>();
  return { ...actual, createDriver: vi.fn(actual.createDriver) };
});
vi.mock("../src/run/page-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof PageRunner>();
  return { ...actual, processPage: vi.fn(actual.processPage) };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

/** The folders these tests made, which are taken away after each. */
const folders: string[] = [];

afterEach(async () => {
  vi.mocked(createDriver).mockClear();
  vi.mocked(processPage).mockClear();
  vi.mocked(readFile).mockClear();
  await Promise.all(
    folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})),
  );
});

/** The file's name, as it's given to a repeat run from the folder it's in. */
const NAME = "walkthrough.json";

/** The most a walkthrough file may be: 8 MB. */
const MAX_BYTES = 8 * 1024 * 1024;

/** A new folder with a page list of `entries`, taken away after the test. */
async function newFolder(entries?: string[]): Promise<string> {
  const dir = await setup(entries);
  folders.push(dir);
  return dir;
}

interface Original {
  dir: string;
  /** The walkthrough's full path, in `dir`. */
  file: string;
  run: RunAuditResult;
}

/**
 * A completed scripted run of the site (three pages), and its walkthrough, written to NAME in the
 * folder it ran from. `extra` changes how the original run was made.
 */
async function original(
  extra: Partial<RunAuditOptions> = {},
  entries?: string[],
): Promise<Original> {
  const dir = await newFolder(entries);
  const run = await runAudit(runOptions(dir, new ScriptedDriver(sitePages()), extra));
  expect(run.outcome).toBe("completed");
  const file = path.join(dir, NAME);
  await writeWalkthrough({
    file,
    run: run.runId,
    out: path.join(dir, "transcripts"),
    site: SITE,
    cwd: dir,
    env: {},
    logger: createMemoryLogger(),
  });
  // What a test looks at is what the repeat does, not what making its original did.
  vi.mocked(createDriver).mockClear();
  vi.mocked(processPage).mockClear();
  return { dir, file, run };
}

/** The walkthrough in `file`, read as a repeat reads it. */
async function walkthroughIn(file: string): Promise<Walkthrough> {
  return parseWalkthrough(await readFile(file, "utf8"), file);
}

/** `file`, rewritten with `change` made to its walkthrough, as a person editing the file would. */
async function edit(file: string, change: (walkthrough: Walkthrough) => void): Promise<void> {
  const walkthrough = JSON.parse(await readFile(file, "utf8")) as Walkthrough;
  change(walkthrough);
  await writeFile(file, `${JSON.stringify(walkthrough, null, 2)}\n`);
}

const sha256Of = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

/**
 * The options of a repeat of `file`, run from `dir`: the helper's own site and page list left out,
 * since the file gives both. `extra` changes any option.
 */
function repeating(
  dir: string,
  driver: ScriptedDriver | undefined,
  file: string,
  extra: Partial<RunAuditOptions> = {},
): RunAuditOptions {
  const { site: _site, pages: _pages, ...own } = runOptions(dir, driver);
  return { ...own, walkthrough: file, ...extra };
}

/** Serves a sitemap at `at` that lists sitePages()'s pages, and 404s everything else. */
function sitemapAt(at: string): typeof fetch {
  const urlset =
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    ["/", "/about", "/resources"].map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("") +
    "</urlset>";
  return (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(
      url === at ? new Response(urlset) : new Response("Not found", { status: 404 }),
    );
  };
}

/** A driver for sitePages() that interrupts the run as it opens the page whose URL ends so. */
function interruptingAt(ending: string, controller: AbortController): ScriptedDriver {
  const driver = new ScriptedDriver(sitePages());
  const openPage = driver.openPage.bind(driver);
  driver.openPage = (url) => {
    if (url.endsWith(ending)) controller.abort();
    return openPage(url);
  };
  return driver;
}

/**
 * The message a repeat of `name` is refused with, run from `folder` (a new one, with no home in it,
 * unless one is given). It also checks what a refusal promises: it's a UsageError, nothing was
 * started or checked, and no folder was made.
 */
async function refusedWith(
  name: string,
  extra: Partial<RunAuditOptions> = {},
  folder?: string,
): Promise<string> {
  const dir = folder ?? (await newFolder());
  const driver = new ScriptedDriver(sitePages());
  const readiness = vi.fn<() => Promise<PlatformReadiness>>();
  vi.mocked(readFile).mockClear();

  const error = await runAudit(repeating(dir, driver, name, { readiness, ...extra })).then(
    () => {
      throw new Error("It wasn't refused.");
    },
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(UsageError);
  expect(driver.starts).toBe(0);
  expect(readiness).not.toHaveBeenCalled();
  expect(vi.mocked(createDriver)).not.toHaveBeenCalled();
  expect(existsSync(path.join(dir, "transcripts"))).toBe(false);
  return (error as UsageError).message;
}

/** A new folder with a copy of `file` in it, as NAME: somewhere no run has been. */
async function copyToNewFolder(file: string): Promise<string> {
  const dir = await newFolder();
  await copyFile(file, path.join(dir, NAME));
  return dir;
}

describe("a run repeated from its walkthrough file", () => {
  it.each<[string, (pages: Walkthrough["pages"]) => Walkthrough["pages"]]>([
    ["as written", (pages) => pages],
    ["reordered by hand", (pages) => [pages[2]!, pages[0]!, pages[1]!]],
  ])("reads exactly the file's pages, in its order, %s", async (_how, arrange) => {
    const { dir, file } = await original();
    await edit(file, (walkthrough) => {
      walkthrough.pages = arrange(walkthrough.pages);
    });
    const listed = (await walkthroughIn(file)).pages.map((page) => page.url);
    const driver = new ScriptedDriver(sitePages());

    const repeat = await runAudit(repeating(dir, driver, NAME));

    expect(repeat.outcome).toBe("completed");
    expect(repeat.run.pages.map((page) => page.url)).toEqual(listed);
    expect([...new Set(driver.opened)]).toEqual(listed);
  });

  it("runs with the file's passes, step limits, capture mode, and readiness", async () => {
    const { dir, file } = await original();
    const readiness = { readySelector: "#app", settleMs: 123, networkIdleTimeoutMs: 4567 };
    await edit(file, (walkthrough) => {
      walkthrough.settings = {
        passes: ["read"],
        stepCaps: { read: 7, headings: 8, tab: 9 },
        capture: "initial",
        readiness,
      };
    });
    const driver = new ScriptedDriver(sitePages());

    const repeat = await runAudit(repeating(dir, driver, NAME));

    expect(repeat.outcome).toBe("completed");
    const { passes, stepCaps, capture, readiness: ranWith } = repeat.run.settings;
    expect({ passes, stepCaps, capture, readiness: ranWith }).toEqual({
      passes: ["read"],
      stepCaps: { read: 7, headings: 8, tab: 9 },
      capture: "initial",
      readiness,
    });
    // Only the read pass ran, and it stopped at the file's limit: the home page takes 8 steps.
    expect(driver.calls).not.toContain("nextHeading");
    expect(driver.calls).not.toContain("nextFocusable");
    expect(Object.keys(repeat.run.pages[0]!.passes)).toEqual(["read"]);
    expect(repeat.run.pages[0]!.passes.read).toMatchObject({ steps: 7, stopReason: "step-cap" });
  });

  it("gives the driver and the page runner the file's capture, step limits, and readiness", async () => {
    const { dir, file, run } = await original();
    const readiness = { readySelector: "#app", settleMs: 123, networkIdleTimeoutMs: 4567 };
    await edit(file, (walkthrough) => {
      walkthrough.settings = {
        passes: ["read"],
        stepCaps: { read: 7, headings: 8, tab: 9 },
        capture: "initial",
        readiness,
      };
    });
    const computer = config({ nvdaSettings: { "speech.rate": 55 } });

    // The replay driver, so the run makes its driver from the config as a real run does.
    const repeat = await runAudit(
      repeating(dir, undefined, NAME, { config: computer, replayFrom: run.runDir }),
    );

    expect(repeat.outcome).toBe("completed");
    const made = vi.mocked(createDriver).mock.calls;
    expect(made).toHaveLength(1);
    // Everything but those three is this computer's, the NVDA settings and the browser included.
    expect(made[0]![1].config).toEqual({
      ...computer.config,
      capture: "initial",
      stepCaps: { read: 7, headings: 8, tab: 9 },
      readiness,
    });
    // The page runner waits for a page as long as the file's readiness says, plus a step's time.
    const waits = vi.mocked(processPage).mock.calls.map(([page]) => page.openTimeoutMs);
    expect(waits).toEqual([4567 + 300, 4567 + 300, 4567 + 300]);
  });

  it("runs with this computer's readiness where the file has none, and records it", async () => {
    const { dir, file, run } = await original();
    await edit(file, (walkthrough) => {
      walkthrough.settings.readiness = null;
    });
    const readiness = { readySelector: "#main", settleMs: 50, networkIdleTimeoutMs: 900 };

    const repeat = await runAudit(
      repeating(dir, undefined, NAME, { config: config({ readiness }), replayFrom: run.runDir }),
    );

    expect(repeat.outcome).toBe("completed");
    expect(repeat.run.settings.readiness).toEqual(readiness);
    expect(vi.mocked(createDriver).mock.calls[0]![1].config.readiness).toEqual(readiness);
    const waits = vi.mocked(processPage).mock.calls.map(([page]) => page.openTimeoutMs);
    expect(waits).toEqual([900 + 300, 900 + 300, 900 + 300]);
  });

  it("keeps this computer's NVDA settings and browser", async () => {
    const { dir, file, run } = await original();
    await edit(file, (walkthrough) => {
      walkthrough.original.nvdaSettings = { "speech.rate": 10 };
      walkthrough.original.browserChannel = "chrome-beta";
    });
    const computer = config({
      nvdaSettings: { "speech.rate": 55 },
      browser: { channel: "msedge", fallbackToChromium: false },
    });

    const repeat = await runAudit(
      repeating(dir, undefined, NAME, { config: computer, replayFrom: run.runDir }),
    );

    expect(repeat.outcome).toBe("completed");
    expect(repeat.run.settings.nvdaSettings).toEqual({ "speech.rate": 55 });
    expect(repeat.run.settings.browser).toEqual({ channel: "msedge", fallbackToChromium: false });
    // And the driver is made with them, not with the file's.
    const { nvdaSettings, browser } = vi.mocked(createDriver).mock.calls[0]![1].config;
    expect({ nvdaSettings, browser }).toEqual({
      nvdaSettings: { "speech.rate": 55 },
      browser: { channel: "msedge", fallbackToChromium: false },
    });
  });

  it("records where its pages came from", async () => {
    const { dir, file, run } = await original();
    const sha256 = await sha256Of(file);

    const repeat = await runAudit(repeating(dir, new ScriptedDriver(sitePages()), NAME));

    expect(repeat.run.settings.source).toEqual({
      kind: "walkthrough",
      file: NAME,
      sha256,
      run: run.runId,
      from: "pages",
    });
    expect(repeat.run.source).toEqual({
      kind: "walkthrough",
      file: NAME,
      sha256,
      listed: 3,
      duplicates: 0,
      invalid: [],
      excludedByFilter: 0,
      excludedByLimit: 0,
      warnings: [],
    });
    // The site is the file's, and nothing narrows the pages.
    expect(repeat.run.site).toBe(SITE);
    expect(repeat.run.settings).toMatchObject({
      site: SITE,
      include: [],
      exclude: [],
      limit: null,
    });
  });

  it("records the file inside the working folder relative to it, with forward slashes", async () => {
    const { dir, file } = await original();
    await mkdir(path.join(dir, "kept"));
    await copyFile(file, path.join(dir, "kept", NAME));

    const repeat = await runAudit(
      repeating(dir, new ScriptedDriver(sitePages()), path.join("kept", NAME)),
    );

    expect(repeat.run.settings.source).toMatchObject({ file: `kept/${NAME}` });
    expect(repeat.run.source.file).toBe(`kept/${NAME}`);
  });

  it("records a file outside the working folder by its full path", async () => {
    const { file } = await original();
    const elsewhere = await newFolder();

    const repeat = await runAudit(repeating(elsewhere, new ScriptedDriver(sitePages()), file));

    expect(repeat.run.settings.source).toMatchObject({ file });
    expect(repeat.run.source.file).toBe(file);
  });

  // Git Bash translates /c/... itself, except with MSYS_NO_PATHCONV=1 set.
  it.runIf(process.platform === "win32")("reads a file written Git Bash's way", async () => {
    const { dir, file } = await original();

    const repeat = await runAudit(
      repeating(dir, new ScriptedDriver(sitePages()), gitBashForm(file)),
    );

    expect(repeat.outcome).toBe("completed");
    expect(repeat.run.settings.source).toMatchObject({ file: NAME });
  });

  it.each<[string, Partial<RunAuditOptions>]>([
    ["sitemap", { pages: null, sitemap: "sitemap.xml", fetch: sitemapAt(`${SITE}/sitemap.xml`) }],
    ["pages", {}],
    ["urls", { pages: null, pageUrls: [`${SITE}/`, `${SITE}/about`, `${SITE}/resources`] }],
  ])("says its pages came from the original's %s", async (from, how) => {
    const { dir, run } = await original(how);

    const repeat = await runAudit(repeating(dir, new ScriptedDriver(sitePages()), NAME));

    expect(repeat.run.settings.source).toMatchObject({ run: run.runId, from });
  });

  it("says what the pages of a repeat's own walkthrough came from, never a walkthrough", async () => {
    const { dir } = await original();
    const first = await runAudit(repeating(dir, new ScriptedDriver(sitePages()), NAME));
    await writeWalkthrough({
      file: path.join(dir, "second.json"),
      run: first.runId,
      out: path.join(dir, "transcripts"),
      site: SITE,
      cwd: dir,
      env: {},
      logger: createMemoryLogger(),
    });

    const second = await runAudit(repeating(dir, new ScriptedDriver(sitePages()), "second.json"));

    expect(second.outcome).toBe("completed");
    expect(second.run.settings.source).toMatchObject({
      kind: "walkthrough",
      file: "second.json",
      run: first.runId,
      from: "pages",
    });
  });

  it("carries each page's label, template, and notes", async () => {
    const { dir, file } = await original();
    await edit(file, (walkthrough) => {
      walkthrough.pages[0]!.label = "Home";
      walkthrough.pages[0]!.template = "home";
      walkthrough.pages[2]!.notes = "Generic link text.";
    });

    const repeat = await runAudit(repeating(dir, new ScriptedDriver(sitePages()), NAME));

    const [home, about, resources] = repeat.run.pages;
    expect(home).toMatchObject({ label: "Home", template: "home" });
    expect(home).not.toHaveProperty("notes");
    expect(about).not.toHaveProperty("label");
    expect(resources).toMatchObject({ notes: "Generic link text." });
  });

  it("reads a page the file lists twice once, and counts the repeats", async () => {
    const { dir, file } = await original();
    await edit(file, (walkthrough) => {
      const home = walkthrough.pages[0]!;
      const about = walkthrough.pages[1]!;
      const resources = walkthrough.pages[2]!;
      // /about/ is /about, and a fragment doesn't make a page: each is the same page again.
      walkthrough.pages = [
        home,
        about,
        { ...about, url: `${SITE}/about/` },
        resources,
        { ...home, url: `${SITE}/#top` },
      ];
    });
    const logger = createMemoryLogger();
    const driver = new ScriptedDriver(sitePages());

    const repeat = await runAudit(repeating(dir, driver, NAME, { logger }));

    expect(repeat.outcome).toBe("completed");
    expect(repeat.run.pages.map((page) => page.url)).toEqual([
      `${SITE}/`,
      `${SITE}/about`,
      `${SITE}/resources`,
    ]);
    expect([...new Set(driver.opened)]).toEqual(repeat.run.pages.map((page) => page.url));
    expect(repeat.run.source).toMatchObject({ kind: "walkthrough", listed: 5, duplicates: 2 });
    expect(repeat.run.source.warnings).toEqual([
      "Ignored 2 duplicate entries; the first listing of each page is used.",
    ]);
    expect(logger.text()).toContain("3 pages to transcribe, 2 duplicates ignored.");
  });

  it.each<[string, string, Partial<RunAuditOptions>]>([
    ["site", "--site", { site: "https://other.example" }],
    ["sitemap", "--sitemap", { sitemap: `${SITE}/sitemap.xml` }],
    ["pages", "--pages", { pages: "pages.json" }],
    ["pageUrls", "--page", { pageUrls: ["/about"] }],
    ["limit", "--limit", { limit: 1 }],
    ["include", "--include", { include: ["/about*"] }],
    ["exclude", "--exclude", { exclude: ["/about*"] }],
    ["passes", "--passes", { passes: ["read"] }],
    ["maxSteps", "--max-steps", { maxSteps: 5 }],
  ])("refuses an option that would change what's read: %s", async (_option, flag, extra) => {
    const { file } = await original();
    const dir = await copyToNewFolder(file);

    const message = await refusedWith(NAME, extra, dir);

    expect(message).toBe(
      `--walkthrough repeats the pages and passes its file lists, so it can't be used with ${flag}.`,
    );
  });

  it("refuses an option that would change what's read before it reads the file", async () => {
    const dir = await newFolder();

    // There's no such file, and the option is still what's refused.
    const message = await refusedWith("nope.json", { limit: 1 }, dir);

    expect(message).toBe(
      "--walkthrough repeats the pages and passes its file lists, so it can't be used with --limit.",
    );
  });

  it.each([SITE, `${SITE}/blog/`, "HTTPS://EXAMPLE.illinois.gov"])(
    "allows --site when it's the file's own site, as %s",
    async (site) => {
      const { dir } = await original();

      const repeat = await runAudit(
        repeating(dir, new ScriptedDriver(sitePages()), NAME, { site }),
      );

      expect(repeat.outcome).toBe("completed");
      expect(repeat.run.site).toBe(SITE);
    },
  );

  it("isn't refused for options that are empty, as the command line gives them when it's given none", async () => {
    const { dir } = await original();

    const repeat = await runAudit(
      repeating(dir, new ScriptedDriver(sitePages()), NAME, {
        sitemap: null,
        pages: null,
        pageUrls: [],
        limit: null,
        include: [],
        exclude: [],
        passes: null,
        maxSteps: null,
      }),
    );

    expect(repeat.outcome).toBe("completed");
  });

  it("needs the site's address or a walkthrough file to run", async () => {
    const dir = await newFolder();
    const { site: _site, ...own } = runOptions(dir, new ScriptedDriver(sitePages()));

    await expect(runAudit(own)).rejects.toThrow(UsageError);
    await expect(runAudit(own)).rejects.toThrow(/^Missing --site <url>/);
    expect(existsSync(path.join(dir, "transcripts"))).toBe(false);
  });

  it("allows --compare, and the other options that don't change what's read", async () => {
    const { dir, file, run } = await original();

    const compared = await runAudit(
      repeating(dir, new ScriptedDriver(sitePages()), NAME, { compare: run.runId }),
    );
    expect(compared.outcome).toBe("completed");
    expect(compared.run.compareTo).toBe(run.runId);

    const named = await runAudit(
      repeating(dir, new ScriptedDriver(sitePages()), NAME, {
        reviewer: "Pat Lee",
        runName: "again",
        fresh: true,
      }),
    );
    expect(named.outcome).toBe("completed");
    expect(named.run.name).toBe("again");
    expect(named.run.sessions[0]?.reviewer).toMatchObject({ name: "Pat Lee", source: "option" });

    // --out: the run goes in that home.
    const home = path.join(dir, "elsewhere");
    const moved = await runAudit(
      repeating(dir, new ScriptedDriver(sitePages()), NAME, { out: home }),
    );
    expect(moved.outcome).toBe("completed");
    expect(moved.siteDir).toBe(path.join(home, siteFolder(SITE)));

    // --replay-from: the replay driver reads the run instead of NVDA (the file's an absolute path).
    const replayed = await runAudit(
      repeating(dir, undefined, file, { replayFrom: run.runDir, out: home }),
    );
    expect(replayed.outcome).toBe("completed");
    expect(replayed.run.replayed).toBe(true);
    expect(replayed.run.settings.replayFrom).toBe(run.runDir.split(path.sep).join("/"));
  });

  it("resumes an interrupted repeat", async () => {
    const { dir } = await original();
    const controller = new AbortController();
    const interrupted = await runAudit(
      repeating(dir, interruptingAt("/about", controller), NAME, { signal: controller.signal }),
    );
    expect(interrupted.outcome).toBe("interrupted");
    expect(interrupted.run.pages.map((page) => page.status)).toEqual([
      "done",
      "pending",
      "pending",
    ]);
    const logger = createMemoryLogger();

    const resumed = await runAudit(
      repeating(dir, new ScriptedDriver(sitePages()), NAME, { logger }),
    );

    expect(resumed.runId).toBe(interrupted.runId);
    expect(resumed.outcome).toBe("completed");
    expect(logger.text()).toContain(`Resuming ${interrupted.runId}: 1 of 3 pages already done.`);
    expect(resumed.run.pages.map((page) => page.status)).toEqual(["done", "done", "done"]);
    // The original and this one: no third run was begun.
    expect(await listRuns(outDir(dir))).toHaveLength(2);
  });

  it("starts a new repeat, and leaves an interrupted one, with --fresh", async () => {
    const { dir } = await original();
    const controller = new AbortController();
    const interrupted = await runAudit(
      repeating(dir, interruptingAt("/about", controller), NAME, { signal: controller.signal }),
    );
    const logger = createMemoryLogger();

    const fresh = await runAudit(
      repeating(dir, new ScriptedDriver(sitePages()), NAME, { fresh: true, logger }),
    );

    expect(fresh.runId).not.toBe(interrupted.runId);
    expect(fresh.outcome).toBe("completed");
    expect(logger.text()).toContain(
      `--fresh: starting a new run. The incomplete run ${interrupted.runId} is left as it is.`,
    );
  });

  it("doesn't resume a repeat of a file that has changed since", async () => {
    const { dir, file } = await original();
    const controller = new AbortController();
    const interrupted = await runAudit(
      repeating(dir, interruptingAt("/about", controller), NAME, { signal: controller.signal }),
    );
    await edit(file, (walkthrough) => {
      walkthrough.pages = walkthrough.pages.slice(0, 2);
    });
    const logger = createMemoryLogger();

    const again = await runAudit(repeating(dir, new ScriptedDriver(sitePages()), NAME, { logger }));

    expect(again.runId).not.toBe(interrupted.runId);
    expect(logger.text()).toContain(
      `Starting a new run. Not resuming ${interrupted.runId} because its settings differ: source: walkthrough ${NAME} from run`,
    );
    expect(again.run.pages).toHaveLength(2);
  });

  it("refuses a walkthrough file it can't read, and runs nothing", async () => {
    const { file } = await original();
    await edit(file, (walkthrough) => {
      walkthrough.pages[1]!.url = "https://other.example/about";
    });
    const dir = await copyToNewFolder(file);

    const message = await refusedWith(NAME, {}, dir);

    expect(message).toBe(
      `${NAME} isn't a voicecap walkthrough file: page 2's address, https://other.example/about, isn't on its site.`,
    );
  });

  it("refuses a file that isn't JSON, and runs nothing", async () => {
    const dir = await newFolder();
    await writeFile(path.join(dir, NAME), "This is not JSON.");

    expect(await refusedWith(NAME, {}, dir)).toBe(
      `${NAME} isn't a voicecap walkthrough file: it isn't JSON.`,
    );
  });

  it("refuses a file that isn't there, and runs nothing", async () => {
    const dir = await newFolder();

    expect(await refusedWith("nope.json", {}, dir)).toMatch(
      /^Can't read the walkthrough file nope\.json: /,
    );
  });

  it("refuses a folder in place of the file, and runs nothing", async () => {
    const dir = await newFolder();
    await mkdir(path.join(dir, "folder.json"));

    expect(await refusedWith("folder.json", {}, dir)).toMatch(
      /^Can't read the walkthrough file folder\.json: /,
    );
  });

  it("refuses a file over 8 MB without reading it, and runs nothing", async () => {
    const dir = await newFolder();
    const big = path.join(dir, "big.json");
    await writeFile(big, "");
    await truncate(big, MAX_BYTES + 1);

    const message = await refusedWith("big.json", {}, dir);

    expect(message).toBe(
      "big.json is larger than 8 MB, larger than any walkthrough file voicecap writes.",
    );
    // Not a byte of it: the file was only looked at, and refused for its size.
    const read = vi.mocked(readFile).mock.calls.map(([target]) => target);
    expect(
      read.filter((target) => typeof target === "string" && target.endsWith("big.json")),
    ).toEqual([]);
  });

  it("reads a file of exactly 8 MB as far as its size goes", async () => {
    const dir = await newFolder();
    const big = path.join(dir, "big.json");
    await writeFile(big, "");
    await truncate(big, MAX_BYTES);

    // Not too big: it's read, and found not to be JSON.
    expect(await refusedWith("big.json", {}, dir)).toBe(
      "big.json isn't a voicecap walkthrough file: it isn't JSON.",
    );
  });

  it("reads a walkthrough file of exactly 8 MB, as the format allows, and refuses one a byte larger for its size", async () => {
    const { dir, file } = await original();
    const walkthrough = await walkthroughIn(file);
    // Notes on the first page make the file exactly the most a walkthrough file may be.
    walkthrough.pages[0]!.notes = "";
    const empty = Buffer.byteLength(walkthroughJson(walkthrough), "utf8");
    walkthrough.pages[0]!.notes = "x".repeat(MAX_BYTES - empty);
    await writeFile(path.join(dir, "at.json"), walkthroughJson(walkthrough));
    walkthrough.pages[0]!.notes += "x";
    await writeFile(path.join(dir, "over.json"), walkthroughJson(walkthrough));
    expect((await stat(path.join(dir, "at.json"))).size).toBe(MAX_BYTES);
    expect((await stat(path.join(dir, "over.json"))).size).toBe(MAX_BYTES + 1);

    // The check before the file is read and the format's own agree on where the limit is.
    const read = await readWalkthroughFile("at.json", dir);
    expect(read.parsed.pages[0]!.notes).toHaveLength(MAX_BYTES - empty);
    await expect(readWalkthroughFile("over.json", dir)).rejects.toThrow(
      "over.json is larger than 8 MB, larger than any walkthrough file voicecap writes.",
    );
  });
});

/**
 * What a run said after it said it was complete, as a person reads it: every message (a warning
 * isn't one) after the one that names run `id`'s report.
 */
function saidAfterComplete(logger: MemoryLogger, id: string): string[] {
  const said = logger.entries
    .filter((entry) => entry.level === "info")
    .map((entry) => entry.message);
  const at = said.findIndex((message) => message.startsWith(`Run ${id} complete. Report: `));
  expect(at).toBeGreaterThanOrEqual(0);
  return said.slice(at + 1);
}

/** What a repeat says of the original run `run`, when every page of the site sounds the same. */
const ALL_THE_SAME = (run: string) => [
  `Compared with run ${run}, from its walkthrough file:`,
  `  ${SITE}/: sounds the same`,
  `  ${SITE}/about: sounds the same`,
  `  ${SITE}/resources: sounds the same`,
  "3 of 3 pages sound the same.",
];

describe("after a repeat completes", () => {
  it("says, page by page, how the repeat sounds against the original", async () => {
    const { dir, run } = await original();
    const logger = createMemoryLogger();

    const repeat = await runAudit(
      repeating(dir, new ScriptedDriver(sitePages()), NAME, { logger }),
    );

    expect(repeat.outcome).toBe("completed");
    // With the script unchanged every page sounds the same. These lines come last, after the one
    // that says the run is complete, and say nothing of versions or settings that don't differ.
    expect(saidAfterComplete(logger, repeat.runId)).toEqual(ALL_THE_SAME(run.runId));
  });

  it("says a page whose script changed sounds different, naming the pass", async () => {
    const { dir, run } = await original();
    const logger = createMemoryLogger();
    const changed = sitePages({
      about: { lines: ["heading, level 1, About us", "We have moved."] },
    });

    const repeat = await runAudit(repeating(dir, new ScriptedDriver(changed), NAME, { logger }));

    expect(repeat.outcome).toBe("completed");
    expect(saidAfterComplete(logger, repeat.runId)).toEqual([
      `Compared with run ${run.runId}, from its walkthrough file:`,
      `  ${SITE}/: sounds the same`,
      `  ${SITE}/about: sounds different (read)`,
      `  ${SITE}/resources: sounds the same`,
      "2 of 3 pages sound the same.",
    ]);
  });

  it("names each pass that sounds different, in the passes' order", async () => {
    const { dir } = await original();
    const logger = createMemoryLogger();
    const changed = sitePages({
      home: { headings: ["heading, level 1, Welcome", "heading, level 2, Latest"] },
      resources: {
        lines: ["heading, level 2, Resources", "End"],
        stops: [{ spoken: "Home, link", focused: element("Home") }],
      },
    });

    await runAudit(repeating(dir, new ScriptedDriver(changed), NAME, { logger }));

    const said = logger.text();
    expect(said).toContain(`  ${SITE}/: sounds different (headings)`);
    expect(said).toContain(`  ${SITE}/about: sounds the same`);
    expect(said).toContain(`  ${SITE}/resources: sounds different (read, tab)`);
    expect(said).toContain("1 of 3 pages sound the same.");
  });

  it("says a page the repeat couldn't read couldn't be read now", async () => {
    const { dir, run } = await original();
    const logger = createMemoryLogger();
    const failing = sitePages({ resources: { status: 404 } });

    const repeat = await runAudit(repeating(dir, new ScriptedDriver(failing), NAME, { logger }));

    // The run completes, with a page that failed: its exit code says so.
    expect(repeat).toMatchObject({ outcome: "completed", exitCode: 3, failedPages: 1 });
    expect(saidAfterComplete(logger, repeat.runId)).toEqual([
      `Compared with run ${run.runId}, from its walkthrough file:`,
      `  ${SITE}/: sounds the same`,
      `  ${SITE}/about: sounds the same`,
      `  ${SITE}/resources: couldn't be read now`,
      "2 of 3 pages sound the same.",
    ]);
  });

  it("says a page the original couldn't read, and the repeat did, wasn't read in the original", async () => {
    const { dir, run } = await original({
      driver: new ScriptedDriver(sitePages({ resources: { status: 404 } })),
    });
    const logger = createMemoryLogger();

    const repeat = await runAudit(
      repeating(dir, new ScriptedDriver(sitePages()), NAME, { logger }),
    );

    expect(repeat).toMatchObject({ outcome: "completed", exitCode: 0 });
    expect(saidAfterComplete(logger, repeat.runId)).toEqual([
      `Compared with run ${run.runId}, from its walkthrough file:`,
      `  ${SITE}/: sounds the same`,
      `  ${SITE}/about: sounds the same`,
      `  ${SITE}/resources: wasn't read in the original`,
      "2 of 3 pages sound the same.",
    ]);
  });

  it("says every page sounds the same for a repeat replayed from the original's own transcripts", async () => {
    const { dir, run } = await original();
    const logger = createMemoryLogger();

    const repeat = await runAudit(
      repeating(dir, undefined, NAME, { replayFrom: run.runDir, logger }),
    );

    expect(repeat.run.replayed).toBe(true);
    expect(saidAfterComplete(logger, repeat.runId)).toEqual(ALL_THE_SAME(run.runId));
  });

  it("says the versions and the NVDA settings that differ from the original's, from the repeat's own record", async () => {
    const { dir, file, run } = await original();
    await edit(file, (walkthrough) => {
      walkthrough.original.screenReader = { name: "NVDA", version: "2026.1" };
      walkthrough.original.browser = { name: "Chrome", version: "140.0.0.0" };
      walkthrough.original.voicecap = "0.0.1";
      walkthrough.original.nvdaSettings = { "speech.rate": 50, "speech.pitch": 40, gone: 1 };
    });
    const logger = createMemoryLogger();
    // This computer's settings, which the repeat runs with and records, are what's compared.
    const computer = config({
      nvdaSettings: { "speech.rate": 55, "speech.pitch": 40, "keyboard.typed": true },
    });

    const repeat = await runAudit(
      repeating(dir, new ScriptedDriver(sitePages()), NAME, { config: computer, logger }),
    );

    expect(repeat.run.settings.nvdaSettings).toEqual(computer.config.nvdaSettings);
    expect(saidAfterComplete(logger, repeat.runId)).toEqual([
      ...ALL_THE_SAME(run.runId),
      `Different from the original: NVDA 2026.2 (was 2026.1), Chrome 141.0.0.0 (was 140.0.0.0), voicecap ${voicecapVersion()} (was 0.0.1).`,
      "NVDA's settings here differ from the original's in: gone, keyboard.typed, speech.rate.",
    ]);
  });

  it("says nothing of the kind for a run that repeats no walkthrough", async () => {
    const dir = await newFolder();
    const logger = createMemoryLogger();

    const result = await runAudit(runOptions(dir, new ScriptedDriver(sitePages()), { logger }));

    expect(result.outcome).toBe("completed");
    expect(logger.text()).not.toMatch(/Compared with|sound the same|sounds /);
  });

  it("says nothing more for a repeat that didn't complete", async () => {
    const { dir } = await original();
    const controller = new AbortController();
    const logger = createMemoryLogger();

    const interrupted = await runAudit(
      repeating(dir, interruptingAt("/about", controller), NAME, {
        signal: controller.signal,
        logger,
      }),
    );

    expect(interrupted.outcome).toBe("interrupted");
    expect(logger.text()).toContain("Interrupted.");
    expect(logger.text()).not.toMatch(/complete\.|Compared with|sound the same|sounds /);
  });

  it("says nothing more for a repeat that stopped", async () => {
    const { dir } = await original();
    const logger = createMemoryLogger();
    const broken = new Error("NVDA is not responding");
    const failing = new ScriptedDriver(
      sitePages({ home: { openError: broken }, about: { openError: broken } }),
    );

    const stopped = await runAudit(
      repeating(dir, failing, NAME, { config: config({ maxConsecutiveFailures: 2 }), logger }),
    );

    expect(stopped.outcome).toBe("stopped");
    expect(logger.text()).toContain("Stopped after 2 failed pages in a row");
    expect(logger.text()).not.toMatch(/complete\.|Compared with|sound the same|sounds /);
  });

  it("says them once, for every page, when a later session completes an interrupted repeat", async () => {
    const { dir, run } = await original();
    const controller = new AbortController();
    const first = createMemoryLogger();
    const interrupted = await runAudit(
      repeating(dir, interruptingAt("/about", controller), NAME, {
        signal: controller.signal,
        logger: first,
      }),
    );
    const second = createMemoryLogger();

    const resumed = await runAudit(
      repeating(dir, new ScriptedDriver(sitePages()), NAME, { logger: second }),
    );

    expect(resumed.runId).toBe(interrupted.runId);
    expect(resumed.outcome).toBe("completed");
    // The page the first session read is compared with the others: it's one run's pages.
    expect(saidAfterComplete(second, resumed.runId)).toEqual(ALL_THE_SAME(run.runId));
    expect(second.text().match(/Compared with run/g)).toHaveLength(1);
    expect(first.text()).not.toContain("Compared with");
  });
});
