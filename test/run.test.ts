import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveConfig, type LoadedConfig } from "../src/config/load.js";
import type { UserConfig } from "../src/config/schema.js";
import { ForegroundError } from "../src/drivers/types.js";
import type { RunJson } from "../src/model.js";
import type { Check, CheckRunner, PlatformReadiness, Problem } from "../src/readiness/model.js";
import { addReview } from "../src/reviews/review.js";
import { runAudit, type RunAuditOptions } from "../src/run/audit.js";
import { regenerateLiveReport } from "../src/run/live-report.js";
import {
  attemptsDir,
  pageDir,
  runCompareDir,
  runDir,
  runReportPath,
  siteFolder,
} from "../src/run/paths.js";
import { readRunJson, writeRunJson } from "../src/run/store.js";
import { EnvironmentError } from "../src/util/errors.js";
import { sealOf } from "../src/util/hash.js";
import { createMemoryLogger } from "../src/util/log.js";
import { verifyHome } from "../src/verify.js";
import { element, ScriptedDriver, type ScriptedPage } from "./helpers/scripted-driver.js";

const SITE = "https://example.illinois.gov";

function sitePages(
  overrides: Partial<Record<"home" | "about" | "resources", Partial<ScriptedPage>>> = {},
): ScriptedPage[] {
  return [
    {
      url: `${SITE}/`,
      lines: [
        "link, Skip to main content",
        "banner landmark, link, Example Agency",
        "main landmark, heading, level 1, Welcome",
        "Grant applications are open.",
        "content info landmark, © 2026 Example Agency",
      ],
      headings: ["heading, level 1, Welcome", "heading, level 2, News"],
      stops: [
        {
          spoken: "Skip to main content, link",
          focused: element("Skip to main content", { href: "#main" }),
        },
        { spoken: "Example Agency, link", focused: element("Example Agency") },
        { spoken: "Grants, link", focused: element("Grants", { inMain: true, href: "/grants" }) },
      ],
      ...overrides.home,
    },
    {
      url: `${SITE}/about`,
      lines: ["heading, level 1, About us", "We are an example.", "© 2026 Example Agency"],
      headings: ["heading, level 1, About us"],
      stops: [{ spoken: "Home, link", focused: element("Home") }],
      ...overrides.about,
    },
    {
      url: `${SITE}/resources`,
      lines: [
        "heading, level 2, Resources",
        "link, Read more",
        "Text",
        "link, Read more",
        "button",
        "End",
      ],
      headings: ["heading, level 2, Resources"],
      stops: [
        { spoken: "Read more, link", focused: element("Read more", { inMain: true }) },
        { spoken: "Read more, link", focused: element("Read more", { inMain: true }) },
        {
          spoken: "button",
          focused: element("", { tag: "button", role: "button", inMain: true, href: null }),
        },
      ],
      ...overrides.resources,
    },
  ];
}

async function setup(entries: string[] = ["/", "/about", "/resources"]): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-run-"));
  await writeFile(path.join(dir, "pages.json"), JSON.stringify(entries));
  return dir;
}

function config(user: UserConfig = {}): LoadedConfig {
  const resolved = resolveConfig({
    timeouts: { stepMs: 300, pageMs: 5000, driverStartMs: 2000 },
    readiness: { readySelector: null, settleMs: 0, networkIdleTimeoutMs: 200 },
    reviewer: "Test Reviewer",
    ...user,
  });
  return { config: resolved, file: null, sha256: "test-config" };
}

function options(
  dir: string,
  driver: ScriptedDriver | undefined,
  extra: Partial<RunAuditOptions> = {},
): RunAuditOptions {
  return {
    site: SITE,
    pages: "pages.json",
    cwd: dir,
    // Never the VOICECAP_TRANSCRIPTS of whoever runs the tests.
    env: {},
    ...(driver ? { driver } : {}),
    config: config(),
    logger: createMemoryLogger(),
    ...extra,
  };
}

/** SITE's folder in the default home, where these runs go. */
const outDir = (dir: string) => path.join(dir, "transcripts", siteFolder(SITE));
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

async function snapshotFolder(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files[path.relative(dir, full)] = sha256(await readFile(full));
    }
  };
  await walk(dir);
  return files;
}

describe("a complete run", () => {
  it("writes the documented layout with verifiable hashes", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(sitePages());
    const result = await runAudit(options(dir, driver));
    expect(result.outcome).toBe("completed");
    expect(result.exitCode).toBe(0);

    const out = outDir(dir);
    const runFolder = runDir(out, result.runId);
    expect(result.runId).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}$/);
    expect((await readFile(path.join(out, "latest.txt"), "utf8")).trim()).toBe(result.runId);
    expect(existsSync(path.join(out, "report.html"))).toBe(true);
    expect(existsSync(path.join(runFolder, "report.html"))).toBe(true);
    expect(await readFile(path.join(dir, "transcripts", ".gitattributes"), "utf8")).toContain(
      "* -text",
    );
    expect(existsSync(path.join(out, ".gitattributes"))).toBe(false);

    const run = await readRunJson(out, result.runId);
    expect(run.status).toBe("completed");
    expect(run.pages.map((p) => p.status)).toEqual(["done", "done", "done"]);
    expect(run.pages[0]?.slug).toBe("home");
    for (const page of run.pages) {
      for (const [file, hash] of Object.entries(page.files)) {
        const bytes = await readFile(path.join(runFolder, "pages", page.slug, file));
        expect(sha256(bytes), `${page.slug}/${file}`).toBe(hash.sha256);
        expect(bytes.length).toBe(hash.bytes);
      }
      expect(Object.keys(page.files).sort()).toEqual([
        "headings.json",
        "headings.txt",
        "read.json",
        "read.txt",
        "tab.json",
        "tab.txt",
      ]);
    }
    expect(run.sessions).toHaveLength(1);
    expect(run.sessions[0]).toMatchObject({ endReason: "completed", pagesDone: 3 });
    expect(run.sessions[0]?.environment?.driver.name).toBe("scripted");

    const txt = await readFile(path.join(runFolder, "pages", "home", "read.txt"), "utf8");
    expect(txt.startsWith("# voicecap transcript: read pass\n")).toBe(true);
    expect(txt).toContain("\n\n[to bottom] content info landmark, © 2026 Example Agency\n");
    expect(txt).not.toContain("\r");

    const resources = run.pages.find((p) => p.url.endsWith("/resources"));
    expect(resources?.flags.map((f) => f.rule)).toEqual(
      expect.arrayContaining(["generic-link-text", "unlabeled", "headings"]),
    );
    expect(driver.starts).toBe(1);
    expect(driver.stops).toBe(1);
  });

  it("skips non-HTML responses and redirects to another origin", async () => {
    const dir = await setup(["/", "/feed", "/contact"]);
    const driver = new ScriptedDriver([
      ...sitePages().slice(0, 1),
      { url: `${SITE}/feed`, contentType: "application/rss+xml" },
      { url: `${SITE}/contact`, finalUrl: "https://forms.example.com/contact" },
    ]);
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(0);
    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.pages.map((p) => p.status)).toEqual(["done", "skipped", "skipped"]);
    expect(run.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "non-html-response",
          contentType: "application/rss+xml",
        }),
        expect.objectContaining({
          reason: "redirect-off-origin",
          finalUrl: "https://forms.example.com/contact",
        }),
      ]),
    );
  });
});

describe("--page", () => {
  it("runs the pages given with --page, and tells runs apart by them", async () => {
    const dir = await setup();
    const first = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { pages: null, pageUrls: [`${SITE}/about`] }),
    );
    expect(first.outcome).toBe("completed");
    expect(first.run.pages).toHaveLength(1);
    expect(first.run.settings.source).toEqual({ kind: "urls", urls: [`${SITE}/about`] });

    const same = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { pages: null, pageUrls: [`${SITE}/about`] }),
    );
    expect(same.run.settingsHash).toBe(first.run.settingsHash);

    const different = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        pages: null,
        pageUrls: [`${SITE}/resources`],
      }),
    );
    expect(different.run.settingsHash).not.toBe(first.run.settingsHash);
  });
});

describe("the home", () => {
  it("puts a run in the site's folder in the home", async () => {
    const dir = await setup();
    const home = path.join(dir, "records");
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { out: "records" }),
    );
    expect(result.siteDir).toBe(path.join(home, siteFolder(SITE)));
    expect(path.isAbsolute(result.runDir)).toBe(true);
    expect(existsSync(path.join(result.runDir, "run.json"))).toBe(true);
  });

  it("takes the home from VOICECAP_TRANSCRIPTS when there's no --out", async () => {
    const dir = await setup();
    const home = path.join(dir, "from-env");
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { env: { VOICECAP_TRANSCRIPTS: home } }),
    );
    expect(result.siteDir).toBe(path.join(home, siteFolder(SITE)));
    expect(existsSync(path.join(result.runDir, "run.json"))).toBe(true);
    expect(existsSync(path.join(dir, "transcripts"))).toBe(false);
  });

  it("works in a home whose path has a space and an accent", async () => {
    const dir = await setup();
    const home = path.join(dir, "Jané Doe", "voicecap-transcripts");
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages()), { out: home }));
    expect(result).toMatchObject({ outcome: "completed", exitCode: 0 });
    const run = await readRunJson(path.join(home, siteFolder(SITE)), result.runId);
    expect(run.status).toBe("completed");
  });
});

describe("voicecap 0.2.0's layout", () => {
  it("leaves 0.2.0-layout folders alone, and says so once", async () => {
    const dir = await setup();
    const home = path.join(dir, "transcripts");
    const oldRun = path.join(home, "runs", "2026-09-26_1405", "run.json");
    const oldManual = path.join(home, "manual", "home", "2026-09-26_1405.json");
    await mkdir(path.dirname(oldRun), { recursive: true });
    await writeFile(oldRun, "old run\n");
    await mkdir(path.dirname(oldManual), { recursive: true });
    await writeFile(oldManual, "old manual\n");

    const logger = createMemoryLogger();
    const result = await runAudit({ ...options(dir, new ScriptedDriver(sitePages())), logger });
    expect(result.outcome).toBe("completed");

    // Neither 0.2.0-layout file was read or moved.
    expect(await readFile(oldRun, "utf8")).toBe("old run\n");
    expect(await readFile(oldManual, "utf8")).toBe("old manual\n");

    const notes = logger.entries.filter((entry) => entry.message.includes("read any more"));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.message).toBe(
      `${home} has voicecap 0.2.0's runs/ and manual/ folders. They aren't read any more, ` +
        "and they're left as they are.",
    );
  });
});

describe("dated run folders", () => {
  it("puts a run in <site>/<date>/<time>/", async () => {
    const dir = await setup();
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { now: () => new Date(2026, 8, 27, 11, 2) }),
    );
    expect(result.runDir).toBe(path.join(outDir(dir), "2026-09-27", "1102"));
  });

  it("gives a second run in the same minute its own folder, and resumes the unfinished one", async () => {
    const dir = await setup();
    const now = () => new Date(2026, 8, 27, 11, 2);

    const first = await runAudit(options(dir, new ScriptedDriver(sitePages()), { now }));
    expect(first).toMatchObject({ runId: "2026-09-27_1102", outcome: "completed" });
    expect(first.runDir).toBe(path.join(outDir(dir), "2026-09-27", "1102"));

    const controller = new AbortController();
    const second = new ScriptedDriver(sitePages());
    const openPage = second.openPage.bind(second);
    second.openPage = (url) => {
      if (url.endsWith("/about")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(options(dir, second, { now, signal: controller.signal }));
    expect(interrupted).toMatchObject({ runId: "2026-09-27_1102-2", outcome: "interrupted" });
    expect(interrupted.runDir).toBe(path.join(outDir(dir), "2026-09-27", "1102-2"));

    const third = await runAudit(options(dir, new ScriptedDriver(sitePages()), { now }));
    expect(third).toMatchObject({ runId: "2026-09-27_1102-2", outcome: "completed" });
  });

  it("keeps a run that passes midnight in the folder of the day it started", async () => {
    const dir = await setup();
    let calls = 0;
    const now = () => (calls++ === 0 ? new Date(2026, 8, 27, 23, 59) : new Date(2026, 8, 28, 0, 1));
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages()), { now }));
    expect(result).toMatchObject({ runId: "2026-09-27_2359", outcome: "completed" });
    expect(result.runDir).toBe(path.join(outDir(dir), "2026-09-27", "2359"));
    const run = await readRunJson(outDir(dir), result.runId);
    for (const page of run.pages) {
      for (const file of Object.keys(page.files)) {
        expect(existsSync(path.join(result.runDir, "pages", page.slug, file))).toBe(true);
      }
    }
  });

  it("finds the previous run of the same site for --compare previous", async () => {
    const dir = await setup();
    const first = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { now: () => new Date(2026, 8, 26, 9, 0) }),
    );
    const second = await runAudit({
      ...options(dir, new ScriptedDriver(sitePages()), { now: () => new Date(2026, 8, 27, 9, 0) }),
      compare: "previous",
    });
    expect(second.run.compareTo).toBe(first.runId);
  });
});

describe("nothing to transcribe", () => {
  it("stops with a usage error, before creating a run or starting the driver", async () => {
    const dir = await setup(["https://www.example.com/elsewhere", "/files/report.pdf"]);
    const driver = new ScriptedDriver(sitePages());
    await expect(runAudit(options(dir, driver))).rejects.toThrow(
      /No pages to transcribe \(2 listed, 2 skipped/,
    );
    await expect(
      runAudit({ ...options(dir, driver), pages: "pages.json", include: ["nwes/*"] }),
    ).rejects.toThrow(/No pages to transcribe/);
    expect(driver.starts).toBe(0);
    expect(existsSync(path.join(outDir(dir), "latest.txt"))).toBe(false);
    // Left empty, so review, manual add, and report don't take it for a site (chooseSiteDir).
    expect(await readdir(outDir(dir))).toEqual([]);
  });
});

describe("failures", () => {
  it("records a failing page, keeps going, and exits 3", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(
      sitePages({
        about: { openError: new ForegroundError("The browser couldn't be brought to the front") },
      }),
    );
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(3);
    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.pages.map((p) => p.status)).toEqual(["done", "failed", "done"]);
    expect(run.pages[1]?.errors.join(" ")).toMatch(/brought to the front/);
    expect(driver.starts).toBe(2); // restarted after the failed page
  });

  it("retries a page once after a timeout, restarting the driver first", async () => {
    const dir = await setup(["/about"]);
    let hung = false;
    const driver = new ScriptedDriver(sitePages(), {
      hang: (command) => {
        if (command === "nextLine" && !hung) {
          hung = true;
          return true;
        }
        return false;
      },
    });
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(0);
    const page = (await readRunJson(outDir(dir), result.runId)).pages[0];
    expect(page).toMatchObject({ status: "done", attempts: 2 });
    expect(page?.errors[0]).toMatch(/Attempt 1 failed/);
    expect(driver.starts).toBe(2);
  });

  it("keeps the first attempt at a page that timed out, and reports only the final one", async () => {
    const dir = await setup(["/about"]);
    let hung = false;
    const driver = new ScriptedDriver(sitePages(), {
      hang: (command) => {
        if (command === "nextLine" && !hung) {
          hung = true;
          return true;
        }
        return false;
      },
    });
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(0);
    const out = outDir(dir);
    const run = await readRunJson(out, result.runId);
    const page = run.pages[0]!;
    expect(page).toMatchObject({ status: "done", attempts: 2 });

    // The timed-out first attempt's partial transcript is kept, not deleted.
    const kept = path.join(attemptsDir(out, result.runId, page.slug), "1");
    expect(await readdir(kept)).toEqual(["read.json", "read.txt"]);

    // The page record only names files from the final attempt, in pages/<slug>/.
    const runFolder = runDir(out, result.runId);
    expect(Object.keys(page.files).sort()).toEqual([
      "headings.json",
      "headings.txt",
      "read.json",
      "read.txt",
      "tab.json",
      "tab.txt",
    ]);
    for (const [file, hash] of Object.entries(page.files)) {
      const bytes = await readFile(path.join(runFolder, "pages", page.slug, file));
      expect(sha256(bytes), file).toBe(hash.sha256);
    }
  });

  it("records the page as failed when the retry times out too", async () => {
    const dir = await setup(["/about", "/"]);
    const driver = new ScriptedDriver(sitePages(), {
      hang: (command, url) => command === "nextLine" && url.endsWith("/about"),
    });
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(3);
    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.pages[0]).toMatchObject({ status: "failed", attempts: 2 });
    expect(run.pages[0]?.passes.read?.stopReason).toBe("timeout");
    expect(run.pages[1]?.status).toBe("done");
  });

  it("stops after too many failed pages in a row, leaving the run resumable (exit 2)", async () => {
    const dir = await setup();
    const broken = new Error("NVDA is not responding");
    const driver = new ScriptedDriver(
      sitePages({
        home: { openError: broken },
        about: { openError: broken },
        resources: { openError: broken },
      }),
    );
    const result = await runAudit({
      ...options(dir, driver),
      config: config({ maxConsecutiveFailures: 2 }),
    });
    expect(result).toMatchObject({ outcome: "stopped", exitCode: 2 });
    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.status).toBe("incomplete");
    expect(run.sessions[0]?.endReason).toBe("environment-failure");
    expect(run.pages.map((p) => p.status)).toEqual(["failed", "failed", "pending"]);
  });

  it("treats HTTP errors as page problems: five 404s in a row don't stop the run", async () => {
    const missing = ["/gone-1", "/gone-2", "/gone-3", "/gone-4", "/gone-5"];
    const dir = await setup(["/", ...missing, "/about"]);
    const driver = new ScriptedDriver([
      ...sitePages(),
      ...missing.map((p) => ({ url: `${SITE}${p}`, status: 404 })),
    ]);
    const result = await runAudit(options(dir, driver));
    expect(result).toMatchObject({ outcome: "completed", exitCode: 3, failedPages: 5 });
    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.pages.at(-1)?.status).toBe("done");
    expect(run.pages.filter((p) => p.failure === "page")).toHaveLength(5);
    expect(driver.starts).toBe(1); // no restarts: the browser and screen reader were fine
  });

  it("resumes a stopped run past the pages that failed, and can still complete", async () => {
    const dir = await setup(["/", "/about", "/resources"]);
    const broken = new Error("NVDA is not responding");
    const failing = () =>
      new ScriptedDriver(sitePages({ home: { openError: broken }, about: { openError: broken } }));
    const stopped = await runAudit({
      ...options(dir, failing()),
      config: config({ maxConsecutiveFailures: 2 }),
    });
    expect(stopped.outcome).toBe("stopped");

    // Still broken for the same two pages: the pending page goes first, the retries don't count.
    const second = failing();
    const resumed = await runAudit({
      ...options(dir, second),
      config: config({ maxConsecutiveFailures: 2 }),
    });
    expect(resumed).toMatchObject({ runId: stopped.runId, outcome: "completed", exitCode: 3 });
    expect(second.opened[0]).toBe(`${SITE}/resources`);
    const run = await readRunJson(outDir(dir), resumed.runId);
    expect(run.pages.map((p) => p.status)).toEqual(["failed", "failed", "done"]);
    expect(run.pages[0]?.failure).toBe("environment");
  });

  it("restarts NVDA and the browser every N pages", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(sitePages());
    await runAudit({ ...options(dir, driver), config: config({ restartEvery: 1 }) });
    expect(driver.starts).toBe(3);
    // Only the final stop gives back what the run took, such as the person's own NVDA.
    expect(driver.stopOptions).toEqual([{ restarting: true }, { restarting: true }, undefined]);
  });
});

describe("interrupting and resuming", () => {
  it("saves state on Ctrl+C, exits 130, and the next run resumes where it stopped", async () => {
    const dir = await setup();
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages());
    const openPage = first.openPage.bind(first);
    first.openPage = (url) => {
      if (url.endsWith("/about")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(options(dir, first, { signal: controller.signal }));
    expect(interrupted).toMatchObject({ outcome: "interrupted", exitCode: 130 });
    expect(first.stops).toBe(1);

    let run = await readRunJson(outDir(dir), interrupted.runId);
    expect(run.status).toBe("incomplete");
    expect(run.pages.map((p) => p.status)).toEqual(["done", "pending", "pending"]);
    expect(run.sessions[0]?.endReason).toBe("interrupted");

    const second = new ScriptedDriver(sitePages());
    const logger = createMemoryLogger();
    const resumed = await runAudit({ ...options(dir, second), logger });
    expect(resumed.runId).toBe(interrupted.runId);
    expect(logger.text()).toContain(`Resuming ${interrupted.runId}: 1 of 3 pages already done.`);
    expect(second.opened.some((url) => url === `${SITE}/`)).toBe(false);
    run = await readRunJson(outDir(dir), resumed.runId);
    expect(run.status).toBe("completed");
    expect(run.sessions.map((s) => s.endReason)).toEqual(["interrupted", "completed"]);
  });

  it("starts a new run when the settings differ, and says why", async () => {
    const dir = await setup();
    const controller = new AbortController();
    controller.abort();
    const first = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { signal: controller.signal }),
    );
    expect(first.outcome).toBe("interrupted");

    const logger = createMemoryLogger();
    const second = await runAudit({
      ...options(dir, new ScriptedDriver(sitePages())),
      passes: ["read"],
      logger,
    });
    expect(second.runId).not.toBe(first.runId);
    expect(logger.text()).toContain(
      `Not resuming ${first.runId} because its settings differ: passes: read,headings,tab → read`,
    );
  });

  it("keeps a page's partial transcripts from before an interruption when the run resumes", async () => {
    const dir = await setup();
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages());
    const openPage = first.openPage.bind(first);
    let aboutLoads = 0;
    first.openPage = (url) => {
      // Interrupted as /about loads for its second pass: its read pass is already written.
      if (url.endsWith("/about") && ++aboutLoads === 2) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(options(dir, first, { signal: controller.signal }));
    expect(interrupted.outcome).toBe("interrupted");
    const out = outDir(dir);
    const about = (await readRunJson(out, interrupted.runId)).pages[1]!;
    expect(about).toMatchObject({ url: `${SITE}/about`, status: "pending" });
    const partial = pageDir(out, interrupted.runId, about.slug);
    expect(await readdir(partial)).toEqual(["read.json", "read.txt"]);
    const partialRead = await readFile(path.join(partial, "read.txt"));

    const resumed = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(resumed).toMatchObject({ runId: interrupted.runId, outcome: "completed" });
    const kept = path.join(attemptsDir(out, resumed.runId, about.slug), "1");
    expect(await readdir(kept)).toEqual(["read.json", "read.txt"]);
    expect(await readFile(path.join(kept, "read.txt"))).toEqual(partialRead);
    expect(await readdir(partial)).toEqual([
      "headings.json",
      "headings.txt",
      "read.json",
      "read.txt",
      "tab.json",
      "tab.txt",
    ]);
  });

  it("--fresh always starts a new run", async () => {
    const dir = await setup();
    // Both runs in one minute: on the real clock, a minute can turn between them.
    const now = () => new Date(2026, 8, 27, 11, 2);
    const controller = new AbortController();
    controller.abort();
    const first = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { signal: controller.signal, now }),
    );
    const logger = createMemoryLogger();
    const second = await runAudit({
      ...options(dir, new ScriptedDriver(sitePages()), { now }),
      fresh: true,
      logger,
    });
    expect(second.runId).not.toBe(first.runId);
    expect(second.runId).toBe(`${first.runId}-2`);
    expect(logger.text()).toContain("--fresh: starting a new run");
  });
});

describe("completed runs are sealed", () => {
  it("seals a run when it completes, but not while it's still interrupted", async () => {
    const dir = await setup();
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages());
    const openPage = first.openPage.bind(first);
    first.openPage = (url) => {
      if (url.endsWith("/about")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(options(dir, first, { signal: controller.signal }));
    expect(interrupted.outcome).toBe("interrupted");

    const out = outDir(dir);
    const incomplete = await readRunJson(out, interrupted.runId);
    expect(incomplete.status).toBe("incomplete");
    expect(incomplete.seal).toBeUndefined();

    const resumed = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(resumed).toMatchObject({ runId: interrupted.runId, outcome: "completed" });
    const run = await readRunJson(out, resumed.runId);
    expect(run.status).toBe("completed");
    expect(run.seal).toBe(sealOf(run));
  });

  it("seals a run resumed with changed flag rules as it's written", async () => {
    const dir = await setup(["/resources", "/", "/about"]);
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages());
    const openPage = first.openPage.bind(first);
    first.openPage = (url) => {
      if (url.endsWith("/about")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(options(dir, first, { signal: controller.signal }));
    expect(interrupted.outcome).toBe("interrupted");
    const out = outDir(dir);
    const before = await readRunJson(out, interrupted.runId);
    expect(before.pages[0]?.flags.map((flag) => flag.rule)).toContain("generic-link-text");

    // Resumed with a flag rule turned off: every page's flags are recomputed as it completes.
    const resumed = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        config: config({ flags: { genericLinkText: { enabled: false } } }),
      }),
    );
    expect(resumed).toMatchObject({ runId: interrupted.runId, outcome: "completed" });
    const run = await readRunJson(out, resumed.runId);
    expect(run.pages[0]?.flags.map((flag) => flag.rule)).not.toContain("generic-link-text");
    expect(run.seal).toBe(sealOf(run));
  });

  it("never modifies a run folder after completion", async () => {
    const dir = await setup();
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const out = outDir(dir);
    const folder = runDir(out, result.runId);
    const before = await snapshotFolder(folder);

    const quiet = createMemoryLogger();
    await addReview({
      page: "/about",
      status: "reviewed",
      cwd: dir,
      env: {},
      config: config(),
      logger: quiet,
    });
    await regenerateLiveReport({ outDir: out, config: config().config, logger: quiet });
    await runAudit({ ...options(dir, new ScriptedDriver(sitePages())), compare: "previous" });

    expect(await snapshotFolder(folder)).toEqual(before);
    const run: RunJson = await readRunJson(out, result.runId);
    await expect(writeRunJson(out, run)).rejects.toThrow(/completed; its folder is never modified/);
  });
});

describe("--compare", () => {
  it("records the base run and writes diffs for pages whose transcripts changed", async () => {
    const dir = await setup();
    const first = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const changed = sitePages({
      about: {
        lines: ["heading, level 1, About us", "We are a changed example.", "© 2026 Example Agency"],
      },
    });
    const second = await runAudit({
      ...options(dir, new ScriptedDriver(changed)),
      compare: "previous",
    });
    const out = outDir(dir);
    const run = await readRunJson(out, second.runId);
    expect(run.compareTo).toBe(first.runId);

    const slug = run.pages.find((p) => p.url.endsWith("/about"))!.slug;
    const inRun = path.join(runCompareDir(out, second.runId, first.runId), slug, "read.diff.txt");
    const live = path.join(
      out,
      "compare",
      `${first.runId}__${second.runId}`,
      slug,
      "read.diff.txt",
    );
    for (const file of [inRun, live]) {
      const diff = await readFile(file, "utf8");
      expect(diff).toContain("-We are an example.");
      expect(diff).toContain("+We are a changed example.");
      expect(diff).not.toContain("# voicecap transcript");
    }
  });

  it("leaves a home that verify finds nothing wrong with", async () => {
    const dir = await setup();
    const first = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const changed = sitePages({
      about: {
        lines: ["heading, level 1, About us", "We are a changed example.", "© 2026 Example Agency"],
      },
    });
    const second = await runAudit({
      ...options(dir, new ScriptedDriver(changed)),
      compare: "previous",
    });
    expect(second.run.compareTo).toBe(first.runId);
    // Diffs in the run's own folder and in the site's compare/.
    expect(await readdir(path.join(second.runDir, "compare"))).toEqual([first.runId]);
    expect(await readdir(path.join(second.siteDir, "compare"))).toEqual([
      `${first.runId}__${second.runId}`,
    ]);

    const logger = createMemoryLogger();
    const result = await verifyHome({ home: path.join(dir, "transcripts"), logger });
    expect(logger.entries.map((entry) => entry.message)).toEqual([
      "example.illinois.gov: 2 runs (0 incomplete), 0 manual sessions, 0 reviews checked: everything matches.",
    ]);
    expect(result.problems).toBe(0);
  });

  it("rejects --compare previous before doing any work when there is no earlier run", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(sitePages());
    await expect(runAudit({ ...options(dir, driver), compare: "previous" })).rejects.toThrow();
    expect(driver.starts).toBe(0);
    // No run was created before the missing base was reported.
    expect(await readdir(outDir(dir))).toEqual([]);
  });
});

describe("replay", () => {
  it("replays a run folder and detects the same stop reasons and content", async () => {
    const dir = await setup();
    const recorded = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const out = outDir(dir);
    const source = await readRunJson(out, recorded.runId);

    const replayed = await runAudit({
      ...options(dir, undefined),
      replayFrom: runDir(path.join("transcripts", siteFolder(SITE)), recorded.runId),
    });
    expect(replayed.exitCode).toBe(0);
    const run = await readRunJson(out, replayed.runId);
    expect(run.replayed).toBe(true);
    expect(run.sessions[0]?.environment?.replay?.sourceRun).toBe(recorded.runId);
    for (const page of source.pages) {
      const again = run.pages.find((p) => p.key === page.key)!;
      for (const pass of ["read", "headings", "tab"] as const) {
        expect(again.passes[pass]?.stopReason, `${page.slug} ${pass}`).toBe(
          page.passes[pass]?.stopReason,
        );
        expect(again.passes[pass]?.contentSha256, `${page.slug} ${pass}`).toBe(
          page.passes[pass]?.contentSha256,
        );
      }
    }
    const txt = await readFile(path.join(pageDir(out, replayed.runId, "home"), "read.txt"), "utf8");
    expect(txt.split("\n")[1]).toMatch(/^# REPLAYED from .*: not a live NVDA session$/);
    const report = await readFile(runReportPath(out, replayed.runId), "utf8");
    expect(report.toLowerCase()).toContain("not a live nvda session");
  });
});

describe("readiness checks before a real run", () => {
  const problem: Problem = {
    title: "NVDA isn't installed",
    whatsWrong: "voicecap couldn't find NVDA on this computer.",
    fix: ["Install NVDA from https://nvaccess.org."],
    setupHelps: true,
  };

  function fakeRunner(id: string, check: Check): CheckRunner {
    return { id, run: () => Promise.resolve(check) };
  }

  /** A platform module whose quick checks are exactly `checks`, naming NVDA on Windows. */
  function fakeReadiness(checks: Check[]): () => Promise<PlatformReadiness> {
    return () =>
      Promise.resolve({
        screenReader: "NVDA",
        cannotRunYet: null,
        readyTip: null,
        liveTestNotice: [],
        checkingNotice: [],
        liveTest: null,
        machineInfo: () =>
          Promise.resolve({
            lines: [],
            screenReader: "NVDA 2026.2",
            system: "Windows 11 Pro 24H2",
          }),
        quickChecks: () => checks.map((check) => fakeRunner(check.id, check)),
      });
  }

  it("rejects before touching the site folder when a check FAILs", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(sitePages());
    const readiness = fakeReadiness([
      { id: "nvda", status: "FAIL", summary: "NVDA isn't installed", problem },
    ]);
    const error: unknown = await runAudit(options(dir, driver, { readiness })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EnvironmentError);
    expect((error as EnvironmentError).exitCode).toBe(2);
    expect((error as Error).message).toMatch(/^Not ready: 1 problem\./);
    expect(driver.starts).toBe(0);
    expect(existsSync(outDir(dir))).toBe(false);
  });

  it("logs the pass summary and WARN lines, then runs normally, when checks are ready", async () => {
    const dir = await setup();
    const logger = createMemoryLogger();
    const driver = new ScriptedDriver(sitePages());
    const readiness = fakeReadiness([
      { id: "log-level", status: "WARN", summary: "NVDA's log level is Debug" },
    ]);
    const result = await runAudit({ ...options(dir, driver, { readiness }), logger });
    expect(result.outcome).toBe("completed");
    expect(logger.text()).toContain(
      "Checks passed: NVDA 2026.2 on Windows 11 Pro 24H2\n  WARN  NVDA's log level is Debug",
    );
  });

  it("never checks a replay run, even when readiness is given", async () => {
    const dir = await setup();
    const recorded = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    let calls = 0;
    const readiness = () => {
      calls++;
      return fakeReadiness([])();
    };
    const replayed = await runAudit({
      ...options(dir, undefined),
      replayFrom: runDir(path.join("transcripts", siteFolder(SITE)), recorded.runId),
      readiness,
    });
    expect(replayed.exitCode).toBe(0);
    expect(calls).toBe(0);
  });

  it("runs no checks when a driver is given directly and no readiness is set", async () => {
    const dir = await setup();
    const logger = createMemoryLogger();
    const driver = new ScriptedDriver(sitePages());
    const result = await runAudit({ ...options(dir, driver), logger });
    expect(result.outcome).toBe("completed");
    expect(logger.text()).not.toMatch(/Checks passed:|Not ready:/);
  });
});
